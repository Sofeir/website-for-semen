import { Router } from 'express';
import { can, closeTasksSchema, taskKindSchema, taskSchema, transferTaskSchema, type Attachment, type TaskDetail } from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { Outbox } from '../notify/notify';
import { broadcast } from '../notify/hub';
import {
  assertActiveUser,
  assertDueNotLater,
  assigneeList,
  canConfirmOverdue,
  canTouchTask,
  closeTasks,
  createTask,
  normalizeDue,
  OVERDUE_CLOSE_MESSAGE,
  remindReset,
  reopenTask,
  requestTaskClose,
  requestTaskExtension,
  settleOverdueNotices,
  EXTEND_MESSAGE,
  TASK_ROW_FIELDS,
  transferTask,
  wasHandedOverBy,
} from '../services/tasks';
import { closeStageTasks, reassignOrder } from '../services/orders';
import { deleteTasksForever } from '../services/testDataCleanup';
import { isAssignee, isWatcher, likeEscape, TASK_AWAITING_ISSUE, TASK_OVERDUE, TASK_SELECT } from '../services/sql';
import { assertTaskVisible } from '../services/access';
import { runServicePlansSoon } from '../services/servicePlans';
import { formatDateTimeRu } from '../services/workTime';

export const tasksRouter = Router();

/**
 * scope: mine — где я исполнитель; created — поставленные мной; all — все (только руководителю).
 * from/to — срок задачи попадает в период (для календаря).
 */
tasksRouter.get(
  '/tasks',
  h(async (req, res) => {
    await runServicePlansSoon();
    const user = req.user!;
    const manageAll = can(user.role, 'tasks.manageAll');
    const scope = String(req.query.scope || 'mine');
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: (p: string) => string, v: unknown) => {
      params.push(v);
      where.push(sql(`$${params.length}`));
    };
    if (scope === 'created') add((p) => `t.creator_id = ${p}`, user.id);
    else if (scope === 'control') {
      // Под контролем: поставил, наблюдает или передавал дальше, но сам не исполняет.
      add(
        (p) =>
          `(t.creator_id = ${p} OR ${isWatcher('t', p)} OR EXISTS (SELECT 1 FROM task_steps cs WHERE cs.task_id = t.id AND cs.from_user_id = ${p}))
           AND NOT ${isAssignee('t', p)}`,
        user.id,
      );
    } else if (scope === 'watching') add((p) => isWatcher('t', p), user.id);
    else if (scope === 'all' && manageAll) {
      if (req.query.assignee) add((p) => isAssignee('t', p), Number(req.query.assignee));
    } else if (scope === 'all') {
      add((p) => `(${isAssignee('t', p)} OR ${isWatcher('t', p)} OR t.creator_id = ${p})`, user.id);
    } else add((p) => isAssignee('t', p), user.id);

    const status = String(req.query.status || 'open');
    if (status === 'open') where.push(`t.status = 'open'`);
    else if (status === 'done') where.push(`t.status <> 'open'`);
    if (req.query.overdue === '1') where.push(TASK_OVERDUE);
    if (req.query.awaiting === '1') where.push(TASK_AWAITING_ISSUE);
    if (req.query.from && req.query.to) {
      add((p) => `t.due_at >= ${p}`, new Date(String(req.query.from)));
      add((p) => `t.due_at < ${p}`, new Date(String(req.query.to)));
    }
    if (req.query.order) add((p) => `t.order_id = ${p}`, Number(req.query.order));
    if (req.query.kind) add((p) => `t.kind_id = ${p}`, Number(req.query.kind));
    const q = String(req.query.q ?? '').trim();
    if (q) add((p) => `(t.title ILIKE ${p} OR t.description ILIKE ${p} OR o.number ILIKE ${p})`, `%${likeEscape(q)}%`);
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    params.push(limit);
    const order = status === 'done' ? 't.closed_at DESC NULLS LAST' : 't.due_at, t.id';
    const rows = await many(
      `${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  }),
);

const KIND_SELECT = `SELECT id, code, name, color, sort, is_active AS "isActive" FROM task_kinds`;

tasksRouter.get(
  '/task-kinds',
  h(async (_req, res) => {
    res.json(await many(`${KIND_SELECT} ORDER BY sort, id`));
  }),
);

/** Новые виды задач заводят прямо в календаре. */
tasksRouter.post(
  '/task-kinds',
  requirePermission('tasks.create'),
  h(async (req, res) => {
    const input = parse(taskKindSchema, req.body);
    const dup = await one('SELECT 1 FROM task_kinds WHERE lower(name) = lower($1)', [input.name]);
    if (dup) throw new HttpError(409, 'Такой вид задач уже есть');
    const max = await one<{ s: number }>('SELECT coalesce(max(sort), 0) AS s FROM task_kinds');
    const row = await one<{ id: number }>(
      'INSERT INTO task_kinds (name, color, sort) VALUES ($1, $2, $3) RETURNING id',
      [input.name, input.color, (max?.s ?? 0) + 10],
    );
    broadcast('changed', { scopes: ['tasks'] });
    res.status(201).json({ id: row!.id });
  }),
);

tasksRouter.put(
  '/task-kinds/:id',
  requirePermission('tasks.create'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(taskKindSchema, req.body);
    const dup = await one('SELECT 1 FROM task_kinds WHERE lower(name) = lower($1) AND id <> $2', [input.name, id]);
    if (dup) throw new HttpError(409, 'Такой вид задач уже есть');
    const r = await pool.query(
      'UPDATE task_kinds SET name = $2, color = $3, is_active = COALESCE($4, is_active) WHERE id = $1',
      [id, input.name, input.color, input.isActive ?? null],
    );
    if (!r.rowCount) throw new HttpError(404, 'Вид задач не найден');
    broadcast('changed', { scopes: ['tasks'] });
    res.json({ ok: true });
  }),
);

tasksRouter.get(
  '/tasks/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const t = await one(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    if (!t) throw new HttpError(404, 'Задача не найдена');
    await assertTaskVisible(req.user!, id);
    const steps = await many(
      `SELECT st.id, st.assignee_id AS "assigneeId", ua.full_name AS "assigneeName", uf.full_name AS "fromUserName",
              st.assigned_at AS "assignedAt", st.due_at AS "dueAt", st.done_at AS "doneAt", st.comment
         FROM task_steps st JOIN users ua ON ua.id = st.assignee_id LEFT JOIN users uf ON uf.id = st.from_user_id
        WHERE st.task_id = $1 ORDER BY st.assigned_at, st.id`,
      [id],
    );
    const checklist = await many(
      `SELECT ci.id, ci.title, ci.done, ci.done_at AS "doneAt", u.full_name AS "doneByName"
         FROM task_checklist_items ci LEFT JOIN users u ON u.id = ci.done_by
        WHERE ci.task_id = $1 ORDER BY ci.sort, ci.id`,
      [id],
    );
    const rows = await many<Omit<Attachment, 'url'>>(
      `SELECT a.id, a.file_name AS "fileName", a.mime, a.size, a.created_at AS "createdAt", u.full_name AS "uploadedBy"
         FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.task_id = $1 ORDER BY a.created_at, a.id`,
      [id],
    );
    const attachments = rows.map((a) => ({ ...a, url: `/api/files/${a.id}` }));
    const handedOverBy = (await wasHandedOverBy(pool, id, req.user!.id)) ? req.user!.id : null;
    const detail: TaskDetail = { ...t, steps, checklist, attachments, handedOverById: handedOverBy };
    res.json(detail);
  }),
);

tasksRouter.post(
  '/tasks',
  requirePermission('tasks.create'),
  h(async (req, res) => {
    const input = parse(taskSchema, req.body);
    const outbox = new Outbox();
    const id = await tx((db) => createTask(db, req.user!, input, outbox));
    await outbox.flush();
    res.status(201).json({ id });
  }),
);

/** Правка полей задачи — постановщику, исполнителю или руководителю. Крайний срок двигает только директор. */
tasksRouter.put(
  '/tasks/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(taskSchema, req.body);
    const t = await one<{
      creator_id: number;
      assignee_ids: number[];
      status: string;
      stage_id: number | null;
      due_at: Date;
      order_id: number | null;
      assignee_id: number;
    }>(
      `SELECT t.creator_id, t.status, t.stage_id, t.due_at, t.order_id, t.assignee_id, ARRAY(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids
         FROM tasks t WHERE t.id = $1`,
      [id],
    );
    if (!t) throw new HttpError(404, 'Задача не найдена');
    if (!canTouchTask(req.user!, t)) throw forbidden('Править задачу может постановщик или исполнитель');
    const manager = can(req.user!.role, 'tasks.manageAll');
    if (t.status !== 'open' && !manager) throw new HttpError(409, 'Закрытую задачу не правят: верните её в работу');
    // Исполнитель правит название, описание и начало; вид задачи и наблюдателей меняет постановщик или руководитель
    const owner = t.creator_id === req.user!.id || manager;
    const outbox = new Outbox();
    const wanted = assigneeList(input).sort((a, b) => a - b);
    const current = [...t.assignee_ids].sort((a, b) => a - b);
    const assigneesChanged = wanted.length !== current.length || wanted.some((x, i) => x !== current[i]);
    if (assigneesChanged) {
      if (!owner) throw new HttpError(403, 'Ответственных меняет постановщик или руководитель. Исполнитель передаёт задачу');
      if (!wanted.length) throw new HttpError(400, 'Выберите ответственного');
      if (t.stage_id) throw new HttpError(400, 'Это задача этапа заявки: передайте задачу или смените ответственного в самой заявке');
    }
    const due = await normalizeDue(pool, input.dueAt);
    // Крайний срок: пока задача не просрочена, его двигает любой сотрудник (продление — с причиной); просроченной — только директор.
    const dueChanged = Math.abs(due.getTime() - t.due_at.getTime()) > 60_000;
    // Перенос срока просроченной задачи не делает её «непросроченной»: снять отметку может только тот, кто подтверждает просрочку.
    const confirms = await canConfirmOverdue(pool, req.user!.id);
    const dueReason = (input.dueReason ?? '').trim();
    if (dueChanged && !confirms) {
      const state = await one<{ overdue: boolean }>(
        `SELECT ((t.due_at < now() OR t.was_overdue) AND NOT ${TASK_AWAITING_ISSUE}) AS overdue FROM tasks t WHERE t.id = $1`,
        [id],
      );
      if (state?.overdue) throw new HttpError(403, EXTEND_MESSAGE);
      if (due.getTime() > t.due_at.getTime() && dueReason.length < 3) throw new HttpError(400, 'Напишите причину продления срока');
    }
    await tx(async (db) => {
      await db.query(
        `UPDATE tasks SET title = $2, description = $3, start_at = $4, due_at = $5,
                kind_id = COALESCE($6, kind_id), was_overdue = CASE WHEN $7 THEN false ELSE was_overdue OR due_at < now() END,
                ${dueChanged ? `${remindReset()},` : ''} updated_at = now() WHERE id = $1`,
        [id, input.title, input.description, input.startAt, dueChanged ? due : t.due_at, owner ? (input.kindId ?? null) : null, confirms && dueChanged],
      );
      if (dueChanged && due.getTime() > Date.now()) await settleOverdueNotices(db, [id]);
      if (dueChanged && t.stage_id && t.order_id && t.status === 'open') {
        // У задачи этапа срок один с заявкой: двигаем и срок этапа, иначе заявка останется «просроченной»
        await db.query('UPDATE orders SET stage_due_at = $2, updated_at = now() WHERE id = $1 AND stage_id = $3', [t.order_id, due, t.stage_id]);
      }
      if (dueChanged && !confirms && dueReason) {
        // Причина и новый срок остаются в цепочке задачи: по ней видно, кто и почему переносил
        await db.query(`INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at, comment) VALUES ($1, $2, $3, $4, $5)`, [
          id,
          t.assignee_id,
          req.user!.id,
          due,
          `Срок перенесён: ${dueReason}`,
        ]);
      }
      if (assigneesChanged) {
        const added = wanted.filter((x) => !current.includes(x));
        const removed = current.filter((x) => !wanted.includes(x));
        const names = new Map<number, string>();
        for (const uid of added) names.set(uid, (await assertActiveUser(db, uid)).full_name);
        // главный ответственный остаётся прежним, если он в новом списке; иначе им становится первый из списка
        await db.query(
          `UPDATE tasks SET assignee_id = CASE WHEN assignee_id = ANY ($2) THEN assignee_id ELSE $3 END,
                  ${added.length ? `${remindReset()},` : ''} updated_at = now() WHERE id = $1`,
          [id, wanted, wanted[0]],
        );
        await db.query('DELETE FROM task_assignees WHERE task_id = $1 AND NOT (user_id = ANY ($2))', [id, wanted]);
        // Это исправление ошибки, а не передача: снятый с задачи не остаётся в цепочке (его незавершённый шаг удаляется)
        await db.query(`DELETE FROM task_steps WHERE task_id = $1 AND assignee_id = ANY ($2) AND done_at IS NULL`, [id, removed]);
        for (const uid of added) {
          await db.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, uid]);
          await db.query(`INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at) VALUES ($1, $2, $3, $4)`, [
            id,
            uid,
            req.user!.id,
            dueChanged ? due : t.due_at,
          ]);
          if (uid !== req.user!.id) {
            outbox.add({
              userId: uid,
              type: 'task_assigned',
              title: `Вам поручили задачу: ${input.title}`,
              body: `От: ${req.user!.fullName}. Срок — ${formatDateTimeRu(dueChanged ? due : t.due_at)}.`,
              link: `/tasks?task=${id}`,
            });
          }
        }
        for (const uid of removed) {
          if (uid === req.user!.id) continue;
          outbox.add({
            userId: uid,
            type: 'task_handover',
            title: `Вас сняли с задачи: ${input.title}`,
            body: `Ответственных исправил(а): ${req.user!.fullName}.`,
            link: `/tasks?task=${id}`,
          });
        }
        outbox.touch('tasks');
      }
      if (input.watcherIds && owner) {
        const want = [...new Set(input.watcherIds)].filter((w) => !wanted.includes(w));
        for (const w of want) await assertActiveUser(db, w);
        const had = (await many<{ user_id: number }>('SELECT user_id FROM task_watchers WHERE task_id = $1', [id], db)).map((r) => r.user_id);
        await db.query('DELETE FROM task_watchers WHERE task_id = $1 AND NOT (user_id = ANY ($2))', [id, want]);
        for (const w of want.filter((x) => !had.includes(x))) {
          await db.query('INSERT INTO task_watchers (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, w]);
          if (w !== req.user!.id) {
            outbox.add({
              userId: w,
              type: 'task_watch',
              title: `Вы наблюдатель задачи: ${input.title}`,
              body: `От: ${req.user!.fullName}. Срок — ${formatDateTimeRu(due)}.`,
              link: `/tasks?task=${id}`,
            });
          }
        }
        outbox.touch('tasks');
      }
    });
    await outbox.flush();
    await pool.query(`UPDATE task_steps SET due_at = $2 WHERE task_id = $1 AND done_at IS NULL`, [id, dueChanged ? due : t.due_at]);
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/tasks/close',
  h(async (req, res) => {
    const input = parse(closeTasksSchema, req.body);
    const outbox = new Outbox();
    const result = await tx(async (db) => {
      // задачи текущего этапа заявки двигают заявку дальше, остальные просто закрываются
      const stage = await closeStageTasks(db, req.user!, input.ids, input.comment, outbox);
      const rest = await closeTasks(
        db,
        req.user!,
        input.ids.filter((x) => !stage.live.has(x)),
        input.comment,
        outbox,
        { overdueNeedsManager: true },
      );
      return {
        closed: [...rest.closed, ...stage.advanced],
        skipped: [...rest.skipped, ...stage.needConfirm, ...stage.blocked.map((b) => b.id)],
        needConfirm: [...rest.needConfirm, ...stage.needConfirm],
        blocked: stage.blocked,
      };
    });
    await outbox.flush();
    if (input.ids.length === 1 && result.needConfirm.length) throw new HttpError(403, OVERDUE_CLOSE_MESSAGE);
    if (input.ids.length === 1 && result.blocked.length) throw new HttpError(409, result.blocked[0].message, { need: result.blocked[0].need });
    res.json(result);
  }),
);

/** Исполнитель просит руководителя подтвердить закрытие просроченной задачи: сам закрыть её он не может. */
tasksRouter.post(
  '/tasks/:id/close-request',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 2000) : '';
    const outbox = new Outbox();
    await tx((db) => requestTaskClose(db, req.user!, id, comment, outbox));
    await outbox.flush();
    res.json({ ok: true });
  }),
);

/** Просьба продлить крайний срок: уходит только директору, он меняет срок в задаче сам. */
tasksRouter.post(
  '/tasks/:id/extend-request',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 2000) : '';
    const wanted = new Date(String(req.body?.dueAt ?? ''));
    if (Number.isNaN(wanted.getTime())) throw new HttpError(400, 'Выберите новый срок');
    const outbox = new Outbox();
    await tx(async (db) => requestTaskExtension(db, req.user!, id, await normalizeDue(db, wanted), comment, outbox));
    await outbox.flush();
    res.json({ ok: true });
  }),
);

/**
 * Удалить закрытую задачу навсегда (директор и администратор). Вместе с ней уходят файлы, цепочка, уведомления; из отчётов она пропадает.
 * Открытую задачу не удаляем: её сначала закрывают.
 */
tasksRouter.delete(
  '/tasks/:id',
  requirePermission('tasks.manageAll'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const t = await one<{ status: string }>('SELECT status FROM tasks WHERE id = $1', [id]);
    if (!t) throw new HttpError(404, 'Задача не найдена');
    if (t.status === 'open') throw new HttpError(409, 'Удалить можно только закрытую задачу. Сначала закройте её');
    await deleteTasksForever([id]);
    const outbox = new Outbox();
    outbox.touch('tasks', 'dashboard');
    await outbox.flush();
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/tasks/:id/reopen',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const outbox = new Outbox();
    await tx((db) => reopenTask(db, req.user!, id, outbox));
    await outbox.flush();
    res.json({ ok: true });
  }),
);

/** Передача задачи. Задача этапа уходит вместе с заявкой, чтобы ответственный по заявке совпадал. */
tasksRouter.post(
  '/tasks/:id/transfer',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(transferTaskSchema, req.body);
    const outbox = new Outbox();
    let requested = false;
    await tx(async (db) => {
      const t = await one<{ order_id: number | null; stage_id: number | null; status: string; due_at: Date; was_overdue: boolean }>(
        `SELECT t.order_id, t.stage_id, t.status, t.due_at, t.was_overdue FROM tasks t WHERE t.id = $1`,
        [id],
        db,
      );
      if (!t) throw new HttpError(404, 'Задача не найдена');
      const due = await normalizeDue(db, input.dueAt);
      if (input.correction) {
        // «Передал не тому»: срок и права проверяет само исправление
      } else if (input.assigneeId === req.user!.id) {
        // Себе передать может любой. Срок при этом можно сдвинуть, пока он не прошёл; у просроченной задачи срок согласует директор.
        if (t.status === 'open' && t.due_at.getTime() < Date.now() && !(await canConfirmOverdue(db, req.user!.id))) {
          await requestTaskExtension(db, req.user!, id, due, input.comment, outbox);
          requested = true;
          return;
        }
      } else {
        // Передать другому можно и срок поменять, пока задача не просрочена; просроченной срок двигает директор.
        await assertDueNotLater(db, req.user!, t.due_at, due, t.was_overdue);
      }
      const order = t.order_id
        ? await one<{ stage_id: number }>('SELECT stage_id FROM orders WHERE id = $1', [t.order_id], db)
        : null;
      if (t.stage_id && order && order.stage_id === t.stage_id && t.status === 'open') {
        await reassignOrder(
          db,
          req.user!,
          t.order_id!,
          { responsibleId: input.assigneeId, dueAt: input.dueAt, comment: input.comment, correction: input.correction },
          outbox,
        );
      } else {
        await transferTask(db, req.user!, id, input, outbox);
      }
    });
    await outbox.flush();
    res.json({ ok: true, requested });
  }),
);

/** Отметка пункта чек-листа — исполнитель, постановщик или руководитель. */
tasksRouter.post(
  '/tasks/:id/checklist/:itemId',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const itemId = intParam(req.params.itemId);
    if (typeof req.body?.done !== 'boolean') throw new HttpError(400, 'Не указано, отмечен ли пункт');
    const t = await one<{ status: string; creator_id: number; assignee_ids: number[] }>(
      `SELECT ${TASK_ROW_FIELDS} FROM tasks t WHERE t.id = $1`,
      [id],
    );
    if (!t) throw new HttpError(404, 'Задача не найдена');
    if (!canTouchTask(req.user!, t)) throw forbidden();
    if (t.status !== 'open') throw new HttpError(409, 'Задача уже закрыта');
    const r = await pool.query(
      `UPDATE task_checklist_items SET done = $3, done_at = CASE WHEN $3 THEN now() END, done_by = CASE WHEN $3 THEN $4::int END
        WHERE id = $2 AND task_id = $1`,
      [id, itemId, req.body.done, req.user!.id],
    );
    if (!r.rowCount) throw new HttpError(404, 'Пункт не найден');
    const outbox = new Outbox();
    outbox.touch('tasks');
    await outbox.flush();
    res.json({ ok: true });
  }),
);
