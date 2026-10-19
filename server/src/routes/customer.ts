import { Router } from 'express';
import { customerTaskSchema, type CustomerOrder, type CustomerTask } from '@sd/shared';
import { many, one, tx } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requireCustomer } from '../auth/session';
import { Outbox } from '../notify/notify';
import { createTask } from '../services/tasks';
import { getWorkSettings } from '../services/settings';
import { defaultDue } from '../services/workTime';
import { ORDER_SELECT } from '../services/sql';

/** Кабинет заказчика: свои задачи и своя техника в ремонте. Ничего чужого он не видит. */
export const customerRouter = Router();
customerRouter.use('/customer', requireCustomer);

const TASK_FIELDS = `
  SELECT t.id, t.title, t.description, t.status, ua.full_name AS "assigneeName",
         t.due_at AS "dueAt", t.created_at AS "createdAt", t.closed_at AS "closedAt", t.close_comment AS "closeComment"
    FROM tasks t JOIN users ua ON ua.id = t.assignee_id`;

customerRouter.get(
  '/customer/tasks',
  h(async (req, res) => {
    const rows = await many<CustomerTask>(
      `${TASK_FIELDS} WHERE t.creator_id = $1
        ORDER BY (t.status = 'open') DESC, CASE WHEN t.status = 'open' THEN t.due_at END, t.closed_at DESC NULLS LAST, t.id DESC`,
      [req.user!.id],
    );
    res.json(rows);
  }),
);

customerRouter.post(
  '/customer/tasks',
  h(async (req, res) => {
    const input = parse(customerTaskSchema, req.body);
    const me = req.user!;
    const outbox = new Outbox();
    const id = await tx(async (db) => {
      // Задача уходит руководителю; если его нет — администратору.
      const boss = await one<{ id: number }>(
        `SELECT id FROM users WHERE is_active AND role IN ('manager', 'admin') ORDER BY (role = 'manager') DESC, id LIMIT 1`,
        [],
        db,
      );
      if (!boss) throw new HttpError(503, 'Сейчас некому принять задачу. Позвоните нам.');
      const ws = await getWorkSettings(db);
      const now = new Date();
      return createTask(
        db,
        me,
        {
          title: input.title,
          description: input.description,
          assigneeId: boss.id,
          clientId: me.clientId,
          startAt: now.toISOString(),
          dueAt: (input.dueAt ? new Date(input.dueAt) : defaultDue(ws, now)).toISOString(),
        },
        outbox,
      );
    });
    await outbox.flush();
    res.status(201).json({ id });
  }),
);

customerRouter.post(
  '/customer/tasks/:id/cancel',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const outbox = new Outbox();
    await tx(async (db) => {
      const t = await one<{ title: string; status: string; assignee_id: number }>(
        'SELECT title, status, assignee_id FROM tasks WHERE id = $1 AND creator_id = $2 FOR UPDATE',
        [id, req.user!.id],
        db,
      );
      if (!t) throw new HttpError(404, 'Задача не найдена');
      if (t.status !== 'open') throw new HttpError(409, 'Задача уже закрыта');
      await db.query(
        `UPDATE tasks SET status = 'cancelled', closed_at = now(), closed_by = $2, close_comment = 'Отменена заказчиком', updated_at = now() WHERE id = $1`,
        [id, req.user!.id],
      );
      await db.query('UPDATE task_steps SET done_at = now() WHERE task_id = $1 AND done_at IS NULL', [id]);
      outbox.add({
        userId: t.assignee_id,
        type: 'task_cancelled',
        title: `Заказчик отменил задачу: ${t.title}`,
        body: `Отменил: ${req.user!.fullName}.`,
        link: `/tasks?task=${id}`,
      });
      outbox.touch('tasks');
    });
    await outbox.flush();
    res.json({ ok: true });
  }),
);

/** Техника заказчика в ремонте: номер, название, этап. Без цен, телефонов и внутренних данных. */
customerRouter.get(
  '/customer/orders',
  h(async (req, res) => {
    const clientId = req.user!.clientId;
    if (!clientId) return res.json([]);
    const rows = await many<Record<string, any>>(
      `SELECT x.*, (SELECT is_final FROM stages WHERE id = x."stageId") AS "isFinal"
         FROM (${ORDER_SELECT} WHERE o.client_id = $1) x
        ORDER BY (x."issuedAt" IS NULL) DESC, x."createdAt" DESC`,
      [clientId],
    );
    const out: CustomerOrder[] = rows.map((r) => ({
      id: r.id,
      number: r.number,
      deviceTitle: r.deviceTitle,
      stageName: r.stageName,
      stageCode: r.stageCode,
      stageColor: r.stageColor,
      isFinal: r.isFinal,
      createdAt: r.createdAt,
      issuedAt: r.issuedAt,
    }));
    res.json(out);
  }),
);

