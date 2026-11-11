import { can, type Role, type TaskInput, type TransferTaskInput } from '@sd/shared';
import { many, one, type Db } from '../db/pool';
import { forbidden, HttpError } from '../lib/http';
import type { Notice, Outbox } from '../notify/notify';
import { getWorkSettings } from './settings';
import { TASK_AWAITING_ISSUE } from './sql';
import { clampToWorkEnd, formatDateTimeRu } from './workTime';

export interface Actor {
  id: number;
  role: Role;
  fullName: string;
}

interface TaskRow {
  id: number;
  title: string;
  status: string;
  creator_id: number;
  assignee_id: number;
  assignee_ids: number[];
  order_id: number | null;
  stage_id: number | null;
}

/** Поля задачи, нужные для проверки прав и уведомлений. Псевдоним таблицы — t. */
export const TASK_ROW_FIELDS = `t.id, t.title, t.status, t.creator_id, t.assignee_id, t.order_id, t.stage_id,
  ARRAY(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids`;

/**
 * Напоминания о сроке считаются от момента remind_from: после смены срока или исполнителя он сдвигается на «сейчас».
 * Напоминание, время которого уже прошло к этому моменту, не шлётся: иначе оно прилетело бы сразу после постановки задачи.
 */
export const remindReset = () => `remind_from = now()`;

/** Кто участвует в задаче: постановщик, нынешние ответственные и все, кто был в цепочке передачи (в том числе передавшие). */
export async function taskParticipantIds(db: Db, taskId: number): Promise<number[]> {
  const rows = await many<{ id: number }>(
    `SELECT creator_id AS id FROM tasks WHERE id = $1
     UNION SELECT user_id FROM task_assignees WHERE task_id = $1
     UNION SELECT user_id FROM task_watchers WHERE task_id = $1
     UNION SELECT assignee_id FROM task_steps WHERE task_id = $1
     UNION SELECT from_user_id FROM task_steps WHERE task_id = $1 AND from_user_id IS NOT NULL`,
    [taskId],
    db,
  );
  return rows.map((r) => r.id);
}

/** Одно уведомление всем получателям без повторов и без тех, кто совершил действие. Директорам и админам копии не шлём: только участникам. */
export function notifyParticipants(
  outbox: Outbox,
  recipients: (number | null | undefined)[],
  skip: number[],
  notice: Omit<Notice, 'userId'>,
) {
  const ids = new Set(recipients.filter((x): x is number => Boolean(x)));
  for (const userId of ids) if (!skip.includes(userId)) outbox.add({ ...notice, userId });
}

export async function assertActiveUser(db: Db, userId: number) {
  const u = await one<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM users WHERE id = $1 AND is_active AND role <> 'customer'`,
    [userId],
    db,
  );
  if (!u) throw new HttpError(400, 'Ответственный не найден или отключён');
  return u;
}

export async function normalizeDue(db: Db, iso: string | Date): Promise<Date> {
  const ws = await getWorkSettings(db);
  return clampToWorkEnd(new Date(iso), ws);
}

/** Список ответственных из запроса: assigneeIds, а старое поле assigneeId (одиночное) тоже принимаем. Без повторов. */
export function assigneeList(input: { assigneeId?: number; assigneeIds?: number[] }): number[] {
  return [...new Set([...(input.assigneeIds ?? []), ...(input.assigneeId ? [input.assigneeId] : [])])];
}

/**
 * Уведомления «просрочена» по задачам, которые больше не просрочены (закрыты или срок перенесён вперёд), отмечаем прочитанными:
 * красный счётчик не должен висеть из-за устаревшего уведомления. Сами уведомления остаются, в них видно нынешнее состояние задачи.
 */
export async function settleOverdueNotices(db: Db, taskIds: number[]) {
  if (!taskIds.length) return;
  await db.query(`UPDATE notifications SET is_read = true WHERE type = 'task_overdue' AND NOT is_read AND link = ANY ($1)`, [
    taskIds.map((id) => `/tasks?task=${id}`),
  ]);
}

/** Задача целиком переходит одному сотруднику: он становится единственным ответственным, срок и напоминания обновляются. */
export async function moveTask(db: Db, taskId: number, userId: number, due: Date) {
  await db.query(
    `UPDATE tasks SET assignee_id = $2, due_at = $3, overdue_notified_at = NULL, was_overdue = (was_overdue OR due_at < now()),
            ${remindReset()}, updated_at = now() WHERE id = $1`,
    [taskId, userId, due],
  );
  await db.query('DELETE FROM task_assignees WHERE task_id = $1 AND user_id <> $2', [taskId, userId]);
  if (due.getTime() > Date.now()) await settleOverdueNotices(db, [taskId]);
}

export async function createTask(
  db: Db,
  actor: Actor,
  input: Omit<TaskInput, 'assigneeId' | 'assigneeIds'> & { assigneeId?: number; assigneeIds?: number[]; stageId?: number | null },
  outbox: Outbox,
): Promise<number> {
  const ids = assigneeList(input);
  if (!ids.length) throw new HttpError(400, 'Выберите ответственного');
  const people: { id: number; full_name: string }[] = [];
  for (const userId of ids) people.push(await assertActiveUser(db, userId));
  const due = await normalizeDue(db, input.dueAt);
  const watcherIds = [...new Set(input.watcherIds ?? [])].filter((w) => !ids.includes(w));
  for (const w of watcherIds) await assertActiveUser(db, w);
  const row = await one<{ id: number }>(
    `INSERT INTO tasks (title, description, creator_id, assignee_id, order_id, client_id, stage_id, start_at, due_at, is_visit, kind_id, visit_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10,
             COALESCE($11, (SELECT id FROM task_kinds WHERE code = $12)), $13) RETURNING id`,
    [
      input.title,
      input.description ?? null,
      actor.id,
      ids[0],
      input.orderId ?? null,
      input.clientId ?? null,
      input.stageId ?? null,
      input.startAt,
      due,
      input.visit ?? false,
      input.kindId ?? null,
      input.visit ? 'visit' : input.orderId ? 'device' : 'general',
      input.visit ? (input.visitMode ?? 'onsite') : 'onsite',
    ],
    db,
  );
  for (const w of watcherIds) {
    await db.query('INSERT INTO task_watchers (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row!.id, w]);
    if (w !== actor.id) {
      outbox.add({
        userId: w,
        type: 'task_watch',
        title: `Вы наблюдатель задачи: ${input.title}`,
        body: `От: ${actor.fullName}. Срок — ${formatDateTimeRu(due)}.`,
        link: `/tasks?task=${row!.id}`,
      });
    }
  }
  for (const userId of ids) {
    await db.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row!.id, userId]);
    await db.query(`INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at) VALUES ($1, $2, $3, $4)`, [
      row!.id,
      userId,
      actor.id,
      due,
    ]);
  }
  if (input.attachmentIds?.length) {
    await db.query(
      `UPDATE attachments SET task_id = $1
        WHERE id = ANY ($2) AND uploaded_by = $3 AND task_id IS NULL AND order_id IS NULL AND client_id IS NULL`,
      [row!.id, input.attachmentIds, actor.id],
    );
  }
  // У выезда нет общего чек-листа: техника клиента проверяется по одной единице, у каждой свой бланк
  const checklist = input.visit ? [] : (input.checklist ?? []).filter(Boolean);
  for (const [i, title] of checklist.entries()) {
    await db.query('INSERT INTO task_checklist_items (task_id, title, sort) VALUES ($1, $2, $3)', [row!.id, title, (i + 1) * 10]);
  }
  // По заявке в уведомлении сразу видно, чья это техника: открывать задачу ради этого не нужно
  const about = input.orderId
    ? await one<{ client: string; device: string }>(
        `SELECT c.name AS client, concat_ws(' ', dt.name, coalesce(b.name, d.brand_text), coalesce(m.name, d.model_text)) AS device
           FROM orders o JOIN clients c ON c.id = o.client_id JOIN devices d ON d.id = o.device_id JOIN device_types dt ON dt.id = d.device_type_id
           LEFT JOIN brands b ON b.id = d.brand_id LEFT JOIN models m ON m.id = d.model_id WHERE o.id = $1`,
        [input.orderId],
        db,
      )
    : null;
  for (const p of people) {
    if (p.id === actor.id) continue;
    const others = people.filter((o) => o.id !== p.id).map((o) => o.full_name);
    outbox.add({
      userId: p.id,
      type: 'task_assigned',
      title: `Новая задача: ${input.title}`,
      body: [
        about && `${about.client}, ${about.device}.`,
        `От: ${actor.fullName}. Срок — ${formatDateTimeRu(due)}.`,
        others.length > 0 && `Вместе с: ${others.join(', ')}.`,
      ]
        .filter(Boolean)
        .join('\n'),
      link: `/tasks?task=${row!.id}`,
    });
  }
  outbox.touch('tasks');
  return row!.id;
}

export function canTouchTask(actor: Actor, t: Pick<TaskRow, 'creator_id' | 'assignee_ids'>) {
  return t.assignee_ids.includes(actor.id) || t.creator_id === actor.id || can(actor.role, 'tasks.manageAll');
}

/**
 * Передал задачу и ошибся адресом: пока задача у того, кому он её отдал, передавший может передать её заново.
 * Больше прав (закрыть, править) ему это не даёт.
 */
export async function wasHandedOverBy(db: Db, taskId: number, userId: number): Promise<boolean> {
  return Boolean(
    await one(
      `SELECT 1 FROM task_steps WHERE task_id = $1 AND done_at IS NULL AND from_user_id = $2 AND assignee_id <> $2
          AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = $1 AND ta.user_id = $2)`,
      [taskId, userId],
      db,
    ),
  );
}

export const OVERDUE_CLOSE_MESSAGE =
  'Задача просрочена: закрыть её можно только с подтверждения директора. Нажмите «Запросить подтверждение» в задаче';

/** Может ли сотрудник закрывать просроченные задачи сам. Такая отметка сейчас у одного человека. */
export async function canConfirmOverdue(db: Db, userId: number): Promise<boolean> {
  return Boolean(await one('SELECT 1 FROM users WHERE id = $1 AND confirms_overdue AND is_active', [userId], db));
}

/**
 * Закрывает задачи пачкой. Все участники задачи, кроме закрывшего, получают уведомление.
 * overdueNeedsManager: просроченную задачу закрывает только тот, кто подтверждает просрочку (директор Вайнштейн), остальные просят его (needConfirm).
 * Закрытие этапа вместе с заявкой идёт без этого условия: там задачу закрывает сам переход заявки.
 */
export async function closeTasks(
  db: Db,
  actor: Actor,
  ids: number[],
  comment: string | null,
  outbox: Outbox,
  opts: { overdueNeedsManager?: boolean } = {},
) {
  const rows = (
    await db.query<TaskRow & { overdue: boolean }>(
      `SELECT ${TASK_ROW_FIELDS}, ((t.due_at < now() OR t.was_overdue) AND NOT ${TASK_AWAITING_ISSUE}) AS overdue FROM tasks t WHERE t.id = ANY ($1) FOR UPDATE OF t`,
      [ids],
    )
  ).rows;
  const closed: number[] = [];
  const skipped: number[] = [];
  const needConfirm: number[] = [];
  const confirms = opts.overdueNeedsManager ? await canConfirmOverdue(db, actor.id) : true;
  for (const t of rows) {
    if (t.status !== 'open' || !canTouchTask(actor, t)) {
      skipped.push(t.id);
      continue;
    }
    if (!confirms && t.overdue) {
      skipped.push(t.id);
      needConfirm.push(t.id);
      continue;
    }
    await db.query(
      `UPDATE tasks SET status = 'done', closed_at = now(), closed_by = $2, close_comment = $3, updated_at = now() WHERE id = $1`,
      [t.id, actor.id, comment],
    );
    await db.query(`UPDATE task_steps SET done_at = now() WHERE task_id = $1 AND done_at IS NULL`, [t.id]);
    closed.push(t.id);
    notifyParticipants(outbox, await taskParticipantIds(db, t.id), [actor.id], {
      type: 'task_closed',
      title: `Задача закрыта: ${t.title}`,
      body: [`Закрыта сотрудником: ${actor.fullName}.`, comment && `Комментарий: ${comment}`].filter(Boolean).join('\n'),
      link: `/tasks?task=${t.id}`,
    });
  }
  for (const id of ids) if (!rows.find((r) => r.id === id)) skipped.push(id);
  await settleOverdueNotices(db, closed);
  outbox.touch('tasks');
  return { closed, skipped, needConfirm };
}

/** Запрос: подтвердите закрытие просроченной задачи. Получает только тот, кто подтверждает просрочку. */
export async function requestTaskClose(db: Db, actor: Actor, id: number, comment: string, outbox: Outbox) {
  const t = await one<TaskRow & { overdue: boolean }>(
    `SELECT ${TASK_ROW_FIELDS}, ((t.due_at < now() OR t.was_overdue) AND NOT ${TASK_AWAITING_ISSUE}) AS overdue FROM tasks t WHERE t.id = $1`,
    [id],
    db,
  );
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!canTouchTask(actor, t)) throw forbidden();
  if (t.status !== 'open') throw new HttpError(409, 'Задача уже закрыта');
  if (!t.overdue) throw new HttpError(400, 'Задача не просрочена: закройте её сами');
  const confirmers = await many<{ id: number }>('SELECT id FROM users WHERE is_active AND confirms_overdue', [], db);
  if (!confirmers.length) throw new HttpError(409, 'Не назначен тот, кто подтверждает закрытие просроченных задач');
  // Запрос уходит только ему: ни постановщику, ни другим руководителям он не приходит.
  notifyParticipants(
    outbox,
    confirmers.map((m) => m.id),
    [actor.id],
    {
      type: 'task_close_request',
      title: `Просят подтвердить закрытие: ${t.title}`,
      body: [`Просрочена. Исполнитель: ${actor.fullName}.`, comment && `Что сделано: ${comment}`].filter(Boolean).join('\n'),
      link: `/tasks?task=${id}`,
    },
  );
  outbox.touch('tasks');
}

export const EXTEND_MESSAGE =
  'Задача просрочена: срок двигает только директор. Нажмите «Запросить продление» в задаче: он получит уведомление и решит';

/**
 * Срок задачи или этапа может менять любой сотрудник, пока срок не прошёл. Если задача уже просрочена (срок вышел или она
 * была просрочена раньше), двигает срок только директор, остальные просят его через «Запросить продление».
 */
export async function assertDueNotLater(db: Db, actor: Actor, currentDue: Date, newDue: Date, wasOverdue = false) {
  if (Math.abs(newDue.getTime() - currentDue.getTime()) <= 60_000) return;
  if (await canConfirmOverdue(db, actor.id)) return;
  if (wasOverdue || currentDue.getTime() < Date.now()) throw new HttpError(403, EXTEND_MESSAGE);
}

/** Просьба продлить крайний срок. Получает только тот, кто подтверждает просрочку: он и меняет срок. */
export async function requestTaskExtension(db: Db, actor: Actor, id: number, wantedDue: Date, comment: string, outbox: Outbox) {
  const t = await one<TaskRow & { due_at: Date }>(`SELECT ${TASK_ROW_FIELDS}, t.due_at FROM tasks t WHERE t.id = $1`, [id], db);
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!canTouchTask(actor, t)) throw forbidden();
  if (t.status !== 'open') throw new HttpError(409, 'Задача уже закрыта');
  if (wantedDue.getTime() <= t.due_at.getTime()) throw new HttpError(400, 'Новый срок должен быть позже нынешнего');
  const confirmers = await many<{ id: number }>('SELECT id FROM users WHERE is_active AND confirms_overdue', [], db);
  if (!confirmers.length) throw new HttpError(409, 'Не назначен тот, кто согласует продление сроков');
  notifyParticipants(
    outbox,
    confirmers.map((m) => m.id),
    [actor.id],
    {
      type: 'task_extend_request',
      title: `Просят продлить срок: ${t.title}`,
      body: [
        `Сейчас — ${formatDateTimeRu(t.due_at)}, просят до ${formatDateTimeRu(wantedDue)}. Исполнитель: ${actor.fullName}.`,
        comment && `Причина: ${comment}`,
      ]
        .filter(Boolean)
        .join('\n'),
      link: `/tasks?task=${id}`,
    },
  );
  outbox.touch('tasks');
}

export async function reopenTask(db: Db, actor: Actor, id: number, outbox: Outbox) {
  const t = await one<TaskRow>(`SELECT ${TASK_ROW_FIELDS} FROM tasks t WHERE t.id = $1 FOR UPDATE OF t`, [id], db);
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!canTouchTask(actor, t)) throw forbidden();
  if (t.status === 'open') return;
  await db.query(
    `UPDATE tasks SET status = 'open', closed_at = NULL, closed_by = NULL, close_comment = NULL, updated_at = now() WHERE id = $1`,
    [id],
  );
  await db.query(
    `INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at, comment)
     SELECT t.id, ta.user_id, $2, t.due_at, 'Возвращена в работу' FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id WHERE t.id = $1`,
    [id, actor.id],
  );
  notifyParticipants(outbox, await taskParticipantIds(db, id), [actor.id], {
    type: 'task_reopened',
    title: `Задача снова в работе: ${t.title}`,
    body: `Кто вернул: ${actor.fullName}.`,
    link: `/tasks?task=${id}`,
  });
  outbox.touch('tasks');
}

/**
 * Передача задачи следующему исполнителю: текущий шаг закрывается, открывается новый.
 * Так строится цепочка «сотрудник A → сотрудник Б → готово» с датами каждого шага.
 * Передавший остаётся участником и дальше получает уведомления по задаче.
 */
export async function transferTask(db: Db, actor: Actor, id: number, input: TransferTaskInput, outbox: Outbox) {
  const t = await one<TaskRow>(`SELECT ${TASK_ROW_FIELDS} FROM tasks t WHERE t.id = $1 FOR UPDATE OF t`, [id], db);
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!canTouchTask(actor, t) && !(await wasHandedOverBy(db, id, actor.id))) throw forbidden();
  if (t.status !== 'open') throw new HttpError(409, 'Задача уже закрыта');
  // Себе задачу передать можно: так исполнитель переносит свой срок и оставляет запись в цепочке. Другому — только если задача ещё не у него.
  if (input.assigneeId !== actor.id && t.assignee_ids.length === 1 && t.assignee_ids[0] === input.assigneeId) {
    throw new HttpError(400, 'Задача уже у этого сотрудника');
  }
  const next = await assertActiveUser(db, input.assigneeId);
  const due = await normalizeDue(db, input.dueAt);
  await db.query(`UPDATE task_steps SET done_at = now() WHERE task_id = $1 AND done_at IS NULL`, [id]);
  await db.query(`INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at, comment) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    input.assigneeId,
    actor.id,
    due,
    input.comment,
  ]);
  await moveTask(db, id, input.assigneeId, due);
  if (input.assigneeId !== actor.id) {
    outbox.add({
      userId: input.assigneeId,
      type: 'task_assigned',
      title: `Вам передали задачу: ${t.title}`,
      body: [`От: ${actor.fullName}. Срок — ${formatDateTimeRu(due)}.`, input.comment].filter(Boolean).join('\n'),
      link: `/tasks?task=${id}`,
    });
  }
  // Все, кто участвовал в задаче раньше (постановщик, прошлые исполнители, передававшие), узнают, кто кому передал её и почему.
  notifyParticipants(outbox, await taskParticipantIds(db, id), [actor.id, input.assigneeId], {
    type: 'task_handover',
    title: `Задачу передали: ${t.title}`,
    body: [`От: ${actor.fullName}. Кому: ${next.full_name}.`, `Причина и что сделано: ${input.comment}`].join('\n'),
    link: `/tasks?task=${id}`,
  });
  outbox.touch('tasks');
  return next;
}
