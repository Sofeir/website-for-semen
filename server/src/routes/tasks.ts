import { Router } from 'express';
import { can, closeTasksSchema, taskSchema, transferTaskSchema, type TaskDetail } from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { Outbox } from '../notify/notify';
import { canTouchTask, closeTasks, createTask, normalizeDue, reopenTask, transferTask } from '../services/tasks';
import { reassignOrder } from '../services/orders';
import { likeEscape, TASK_SELECT } from '../services/sql';

export const tasksRouter = Router();

/**
 * scope: mine — где я исполнитель; created — поставленные мной; all — все (только руководителю).
 * from/to — срок задачи попадает в период (для календаря).
 */
tasksRouter.get(
  '/tasks',
  h(async (req, res) => {
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
    else if (scope === 'all' && manageAll) {
      if (req.query.assignee) add((p) => `t.assignee_id = ${p}`, Number(req.query.assignee));
    } else if (scope === 'all') {
      add((p) => `(t.assignee_id = ${p} OR t.creator_id = ${p})`, user.id);
    } else add((p) => `t.assignee_id = ${p}`, user.id);

    const status = String(req.query.status || 'open');
    if (status === 'open') where.push(`t.status = 'open'`);
    else if (status === 'done') where.push(`t.status <> 'open'`);
    if (req.query.overdue === '1') where.push(`t.status = 'open' AND t.due_at < now()`);
    if (req.query.from && req.query.to) {
      add((p) => `t.due_at >= ${p}`, new Date(String(req.query.from)));
      add((p) => `t.due_at < ${p}`, new Date(String(req.query.to)));
    }
    if (req.query.order) add((p) => `t.order_id = ${p}`, Number(req.query.order));
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

tasksRouter.get(
  '/tasks/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const t = await one(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    if (!t) throw new HttpError(404, 'Задача не найдена');
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
    const detail: TaskDetail = { ...t, steps, checklist };
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

/** Правка полей задачи — постановщику или руководителю. */
tasksRouter.put(
  '/tasks/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(taskSchema, req.body);
    const t = await one<{ creator_id: number; assignee_id: number; status: string; stage_id: number | null }>(
      'SELECT creator_id, assignee_id, status, stage_id FROM tasks WHERE id = $1',
      [id],
    );
    if (!t) throw new HttpError(404, 'Задача не найдена');
    if (!(t.creator_id === req.user!.id || can(req.user!.role, 'tasks.manageAll')))
      throw forbidden('Править задачу может постановщик');
    if (t.assignee_id !== input.assigneeId) throw new HttpError(400, 'Чтобы сменить исполнителя, передайте задачу');
    const due = await normalizeDue(pool, input.dueAt);
    const deadline = input.deadlineAt ? await normalizeDue(pool, input.deadlineAt) : null;
    await pool.query(
      `UPDATE tasks SET title = $2, description = $3, start_at = $4, due_at = $5, deadline_at = $6, updated_at = now() WHERE id = $1`,
      [id, input.title, input.description, input.startAt, due, deadline],
    );
    await pool.query(`UPDATE task_steps SET due_at = $2 WHERE task_id = $1 AND done_at IS NULL`, [id, due]);
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/tasks/close',
  h(async (req, res) => {
    const input = parse(closeTasksSchema, req.body);
    const outbox = new Outbox();
    const result = await tx((db) => closeTasks(db, req.user!, input.ids, input.comment, outbox));
    await outbox.flush();
    res.json(result);
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
    await tx(async (db) => {
      const t = await one<{ order_id: number | null; stage_id: number | null; status: string }>(
        `SELECT t.order_id, t.stage_id, t.status FROM tasks t WHERE t.id = $1`,
        [id],
        db,
      );
      if (!t) throw new HttpError(404, 'Задача не найдена');
      const order = t.order_id
        ? await one<{ stage_id: number }>('SELECT stage_id FROM orders WHERE id = $1', [t.order_id], db)
        : null;
      if (t.stage_id && order && order.stage_id === t.stage_id && t.status === 'open') {
        await reassignOrder(
          db,
          req.user!,
          t.order_id!,
          { responsibleId: input.assigneeId, dueAt: input.dueAt, comment: input.comment },
          outbox,
        );
      } else {
        await transferTask(db, req.user!, id, input, outbox);
      }
    });
    await outbox.flush();
    res.json({ ok: true });
  }),
);

/** Отметка пункта чек-листа — исполнитель, постановщик или руководитель. */
tasksRouter.post(
  '/tasks/:id/checklist/:itemId',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const itemId = intParam(req.params.itemId);
    if (typeof req.body?.done !== 'boolean') throw new HttpError(400, 'Не указано, отмечен ли пункт');
    const t = await one<{
      id: number;
      title: string;
      status: string;
      creator_id: number;
      assignee_id: number;
      order_id: number | null;
      stage_id: number | null;
    }>('SELECT id, title, status, creator_id, assignee_id, order_id, stage_id FROM tasks WHERE id = $1', [id]);
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
