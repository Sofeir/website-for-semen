import { can, type Role, type TaskInput, type TransferTaskInput } from '@sd/shared';
import { many, one, type Db } from '../db/pool';
import { forbidden, HttpError } from '../lib/http';
import type { Notice, Outbox } from '../notify/notify';
import { getWorkSettings } from './settings';
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
  order_id: number | null;
  stage_id: number | null;
}

/** Руководители и администраторы — они получают копию уведомлений о передачах и просрочках. */
export async function overseerIds(db: Db): Promise<number[]> {
  const rows = await many<{ id: number }>(
    `SELECT id FROM users WHERE is_active AND role IN ('admin', 'manager')`,
    [],
    db,
  );
  return rows.map((r) => r.id);
}

/** Одно уведомление всем получателям без повторов и без тех, кто совершил действие. */
export async function notifyHandover(
  db: Db,
  outbox: Outbox,
  recipients: (number | null | undefined)[],
  skip: number[],
  notice: Omit<Notice, 'userId'>,
) {
  const ids = new Set([...recipients, ...(await overseerIds(db))].filter((x): x is number => Boolean(x)));
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


export async function createTask(
  db: Db,
  actor: Actor,
  input: TaskInput & { stageId?: number | null },
  outbox: Outbox,
): Promise<number> {
  await assertActiveUser(db, input.assigneeId);
  const due = await normalizeDue(db, input.dueAt);
  const deadline = input.deadlineAt ? await normalizeDue(db, input.deadlineAt) : null;
  const row = await one<{ id: number }>(
    `INSERT INTO tasks (title, description, creator_id, assignee_id, order_id, client_id, stage_id, start_at, due_at, deadline_at, is_visit, kind_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             COALESCE($12, (SELECT id FROM task_kinds WHERE code = $13))) RETURNING id`,
    [
      input.title,
      input.description ?? null,
      actor.id,
      input.assigneeId,
      input.orderId ?? null,
      input.clientId ?? null,
      input.stageId ?? null,
      input.startAt,
      due,
      deadline,
      input.visit ?? false,
      input.kindId ?? null,
      input.visit ? 'visit' : input.orderId ? 'device' : 'general',
    ],
    db,
  );
  await db.query(`INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at) VALUES ($1, $2, $3, $4)`, [
    row!.id,
    input.assigneeId,
    actor.id,
    due,
  ]);
  // У выезда нет общего чек-листа: техника клиента проверяется по одной единице, у каждой свой бланк
  const checklist = input.visit ? [] : (input.checklist ?? []).filter(Boolean);
  for (const [i, title] of checklist.entries()) {
    await db.query('INSERT INTO task_checklist_items (task_id, title, sort) VALUES ($1, $2, $3)', [row!.id, title, (i + 1) * 10]);
  }
  if (input.assigneeId !== actor.id) {
    outbox.add({
      userId: input.assigneeId,
      type: 'task_assigned',
      title: `Новая задача: ${input.title}`,
      body: `От: ${actor.fullName}. Срок — ${formatDateTimeRu(due)}.`,
      link: `/tasks?task=${row!.id}`,
    });
  }
  outbox.touch('tasks');
  return row!.id;
}

export function canTouchTask(actor: Actor, t: TaskRow) {
  return t.assignee_id === actor.id || t.creator_id === actor.id || can(actor.role, 'tasks.manageAll');
}

/** Закрывает задачи пачкой. Постановщик получает уведомление, если закрыл не он сам. */
export async function closeTasks(db: Db, actor: Actor, ids: number[], comment: string | null, outbox: Outbox) {
  const rows = (
    await db.query<TaskRow>(
      `SELECT id, title, status, creator_id, assignee_id, order_id, stage_id FROM tasks WHERE id = ANY ($1) FOR UPDATE`,
      [ids],
    )
  ).rows;
  const closed: number[] = [];
  const skipped: number[] = [];
  for (const t of rows) {
    if (t.status !== 'open' || !canTouchTask(actor, t)) {
      skipped.push(t.id);
      continue;
    }
    await db.query(
      `UPDATE tasks SET status = 'done', closed_at = now(), closed_by = $2, close_comment = $3, updated_at = now() WHERE id = $1`,
      [t.id, actor.id, comment],
    );
    await db.query(`UPDATE task_steps SET done_at = now() WHERE task_id = $1 AND done_at IS NULL`, [t.id]);
    closed.push(t.id);
    if (t.creator_id !== actor.id) {
      outbox.add({
        userId: t.creator_id,
        type: 'task_closed',
        title: `Задача закрыта: ${t.title}`,
        body: [`Закрыта сотрудником: ${actor.fullName}.`, comment && `Комментарий: ${comment}`].filter(Boolean).join('\n'),
        link: `/tasks?task=${t.id}`,
      });
    }
  }
  for (const id of ids) if (!rows.find((r) => r.id === id)) skipped.push(id);
  outbox.touch('tasks');
  return { closed, skipped };
}

export async function reopenTask(db: Db, actor: Actor, id: number, outbox: Outbox) {
  const t = await one<TaskRow>(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [id], db);
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!canTouchTask(actor, t)) throw forbidden();
  if (t.status === 'open') return;
  await db.query(
    `UPDATE tasks SET status = 'open', closed_at = NULL, closed_by = NULL, close_comment = NULL, updated_at = now() WHERE id = $1`,
    [id],
  );
  await db.query(
    `INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at, comment)
     SELECT id, assignee_id, $2, due_at, 'Возвращена в работу' FROM tasks WHERE id = $1`,
    [id, actor.id],
  );
  if (t.assignee_id !== actor.id) {
    outbox.add({
      userId: t.assignee_id,
      type: 'task_reopened',
      title: `Задача снова в работе: ${t.title}`,
      body: `Кто вернул: ${actor.fullName}.`,
      link: `/tasks?task=${id}`,
    });
  }
  outbox.touch('tasks');
}

/**
 * Передача задачи следующему исполнителю: текущий шаг закрывается, открывается новый.
 * Так строится цепочка «сотрудник A → сотрудник Б → готово» с датами каждого шага.
 */
export async function transferTask(db: Db, actor: Actor, id: number, input: TransferTaskInput, outbox: Outbox) {
  const t = await one<TaskRow>(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [id], db);
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!canTouchTask(actor, t)) throw forbidden();
  if (t.status !== 'open') throw new HttpError(409, 'Задача уже закрыта');
  if (t.assignee_id === input.assigneeId) throw new HttpError(400, 'Задача уже у этого сотрудника');
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
  await db.query(`UPDATE tasks SET assignee_id = $2, due_at = $3, overdue_notified_at = NULL, updated_at = now() WHERE id = $1`, [id, input.assigneeId, due]);
  if (input.assigneeId !== actor.id) {
    outbox.add({
      userId: input.assigneeId,
      type: 'task_assigned',
      title: `Вам передали задачу: ${t.title}`,
      body: [`От: ${actor.fullName}. Срок — ${formatDateTimeRu(due)}.`, input.comment].filter(Boolean).join('\n'),
      link: `/tasks?task=${id}`,
    });
  }
  // Постановщик, прошлый исполнитель и руководители узнают, кто кому передал задачу и почему.
  await notifyHandover(db, outbox, [t.creator_id, t.assignee_id], [actor.id, input.assigneeId], {
    type: 'task_handover',
    title: `Задачу передали: ${t.title}`,
    body: [`От: ${actor.fullName}. Кому: ${next.full_name}.`, `Причина и что сделано: ${input.comment}`].join('\n'),
    link: `/tasks?task=${id}`,
  });
  outbox.touch('tasks');
  return next;
}
