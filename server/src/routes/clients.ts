import { Router } from 'express';
import {
  can,
  clientSchema,
  fleetSchema,
  serviceChecklistSchema,
  servicePlanSchema,
  type ClientDetail,
  type ServicePlan,
  type VisitsData,
} from '@sd/shared';
import { many, one, tx } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { createClient, replaceFleet, updateClient } from '../services/clients';
import { CLIENT_FIELDS, DEVICE_SELECT, likeEscape, ORDER_SELECT, orderAccess, TASK_SELECT, taskAccess } from '../services/sql';
import { broadcast } from '../notify/hub';
import {
  getServicePlan,
  nextVisitDate,
  runServicePlans,
  runServicePlansSoon,
  SERVICE_PLAN_SELECT,
} from '../services/servicePlans';
import { assertActiveUser } from '../services/tasks';

export const clientsRouter = Router();

/** Поиск клиента: по имени/названию, контактному лицу, ИНН и по цифрам телефона. */
clientsRouter.get(
  '/clients',
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const kind = req.query.kind === 'person' || req.query.kind === 'legal' ? req.query.kind : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const params: unknown[] = [];
    const where: string[] = [];
    if (kind) {
      params.push(kind);
      where.push(`c.kind = $${params.length}`);
    }
    if (q) {
      params.push(`%${likeEscape(q)}%`);
      const like = `$${params.length}`;
      // Телефон в базе хранится как 7XXXXXXXXXX: ведущую 8 при поиске считаем семёркой.
      let digits = q.replace(/\D/g, '');
      if (digits.startsWith('8')) digits = '7' + digits.slice(1);
      const parts = [`c.name ILIKE ${like}`, `c.contact_person ILIKE ${like}`, `c.inn ILIKE ${like}`, `c.email ILIKE ${like}`];
      // Сотрудники организации и техника клиента: по ФИО, серийному и своему номеру
      parts.push(
        `EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.client_id = c.id AND cc.full_name ILIKE ${like})`,
        `EXISTS (SELECT 1 FROM devices dv WHERE dv.client_id = c.id AND (dv.serial ILIKE ${like} OR dv.inventory_no ILIKE ${like}))`,
      );
      if (digits.length >= 3) {
        params.push(`%${digits}%`);
        parts.push(`c.phone_digits LIKE $${params.length}`);
        parts.push(`EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.client_id = c.id AND cc.phone_digits LIKE $${params.length})`);
      }
      where.push(`(${parts.join(' OR ')})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const rows = await many(
      `SELECT ${CLIENT_FIELDS},
              (SELECT count(*) FROM orders o WHERE o.client_id = c.id) AS "ordersCount",
              (SELECT count(*) FROM orders o JOIN stages s ON s.id = o.stage_id WHERE o.client_id = c.id AND NOT s.is_final) AS "activeCount",
              count(*) OVER () AS total
         FROM clients c ${whereSql}
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 });
  }),
);

clientsRouter.get(
  '/clients/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const client = await one(`SELECT ${CLIENT_FIELDS} FROM clients c WHERE c.id = $1`, [id]);
    if (!client) throw new HttpError(404, 'Клиент не найден');
    const seeAll = can(req.user!.role, 'orders.viewAll');
    const seeAllTasks = can(req.user!.role, 'tasks.manageAll');
    const mine = seeAll ? '' : `AND ${orderAccess('o', '$2')}`;
    const args = seeAll ? [id] : [id, req.user!.id];
    const [devices, orders, tasks, receipts, acts, attachments, fleet] = await Promise.all([
      many(`${DEVICE_SELECT} WHERE d.client_id = $1 ORDER BY d.created_at DESC`, [id]),
      many(
        `${ORDER_SELECT} WHERE o.client_id = $1 ${seeAll ? '' : `AND ${orderAccess('o', '$2')}`} ORDER BY o.created_at DESC`,
        seeAll ? [id] : [id, req.user!.id],
      ),
      many(
        `${TASK_SELECT} WHERE coalesce(t.client_id, o.client_id) = $1 ${seeAllTasks ? '' : `AND ${taskAccess('t', '$2')}`}
          ORDER BY (t.status = 'open') DESC, t.due_at DESC LIMIT 100`,
        seeAllTasks ? [id] : [id, req.user!.id],
      ),
      many(
        `SELECT b.id, b.created_at AS "createdAt", string_agg(o.number, ', ' ORDER BY o.number) AS "orderNumber"
           FROM intake_batches b JOIN orders o ON o.batch_id = b.id
          WHERE b.client_id = $1 ${mine} GROUP BY b.id ORDER BY b.created_at DESC`,
        args,
      ),
      many(
        `SELECT a.id, a.number, a.created_at AS "createdAt", o.number AS "orderNumber"
           FROM acts a JOIN orders o ON o.id = a.order_id WHERE o.client_id = $1 ${mine} ORDER BY a.created_at DESC`,
        args,
      ),
      many(
        `SELECT a.id, a.file_name AS "fileName", a.mime, a.size, a.created_at AS "createdAt", u.full_name AS "uploadedBy",
                '/api/files/' || a.id AS url
           FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
          WHERE a.client_id = $1 ORDER BY a.created_at DESC`,
        [id],
      ),
      many(
        `SELECT id, department, pc_count AS "pcCount", mfu_count AS "mfuCount", reserve, ssd_check AS "ssdCheck", note
           FROM fleet_rows WHERE client_id = $1 ORDER BY sort, id`,
        [id],
      ),
    ]);
    const documents = [
      ...receipts.map((r) => ({
        kind: 'receipt' as const,
        id: r.id,
        number: r.orderNumber,
        createdAt: r.createdAt,
        orderNumber: r.orderNumber,
        url: `/api/documents/receipt/${r.id}.pdf`,
      })),
      ...acts.map((a) => ({
        kind: 'act' as const,
        id: a.id,
        number: a.number,
        createdAt: a.createdAt,
        orderNumber: a.orderNumber,
        url: `/api/documents/act/${a.id}.pdf`,
      })),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const detail: ClientDetail = { ...client, devices, orders, tasks, documents, attachments, fleet };
    res.json(detail);
  }),
);

clientsRouter.get(
  '/clients/:id/devices',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    res.json(await many(`${DEVICE_SELECT} WHERE d.client_id = $1 ORDER BY d.created_at DESC`, [id]));
  }),
);

clientsRouter.post(
  '/clients',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const input = parse(clientSchema, req.body);
    const id = await tx((db) => createClient(db, req.user!.id, input));
    broadcast('changed', { scopes: ['clients'] });
    res.status(201).json({ id });
  }),
);

clientsRouter.put(
  '/clients/:id',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(clientSchema, req.body);
    await tx((db) => updateClient(db, id, input));
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.json({ ok: true });
  }),
);

clientsRouter.put(
  '/clients/:id/fleet',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const { rows } = parse(fleetSchema, req.body);
    const c = await one<{ kind: string }>('SELECT kind FROM clients WHERE id = $1', [id]);
    if (!c) throw new HttpError(404, 'Клиент не найден');
    if (c.kind !== 'legal') throw new HttpError(400, 'Чек-лист парка ведём только для юрлиц');
    await tx((db) => replaceFleet(db, id, rows));
    broadcast('changed', { scopes: ['clients'] });
    res.json({ ok: true });
  }),
);

/** Список работ на точке клиента: из него собирается чек-лист выезда. */
clientsRouter.get(
  '/clients/:id/service-checklist',
  h(async (req, res) => {
    const rows = await many<{ title: string }>(
      'SELECT title FROM service_checklist_items WHERE client_id = $1 ORDER BY sort, id',
      [intParam(req.params.id)],
    );
    res.json({ items: rows.map((r) => r.title) });
  }),
);

clientsRouter.put(
  '/clients/:id/service-checklist',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const { items } = parse(serviceChecklistSchema, req.body);
    await tx(async (db) => {
      const c = await one('SELECT 1 FROM clients WHERE id = $1', [id], db);
      if (!c) throw new HttpError(404, 'Клиент не найден');
      await db.query('DELETE FROM service_checklist_items WHERE client_id = $1', [id]);
      for (const [i, title] of items.filter(Boolean).entries()) {
        await db.query('INSERT INTO service_checklist_items (client_id, title, sort) VALUES ($1, $2, $3)', [
          id,
          title,
          (i + 1) * 10,
        ]);
      }
    });
    broadcast('changed', { scopes: ['clients'] });
    res.json({ ok: true });
  }),
);

/** Ближайшие даты по графику — для обзора «кто к кому и когда едет». */
const withUpcoming = (p: ServicePlan): ServicePlan => {
  const upcoming = [p.nextDate];
  while (upcoming.length < 3) upcoming.push(nextVisitDate(upcoming[upcoming.length - 1], p.everyN, p.unit));
  return { ...p, upcoming };
};

/**
 * Все выезды: задачи-выезды и графики регулярных выездов.
 * Руководитель видит всех (можно отфильтровать по сотруднику), остальные — только свои.
 */
clientsRouter.get(
  '/visits',
  h(async (req, res) => {
    await runServicePlansSoon();
    const user = req.user!;
    const all = can(user.role, 'tasks.manageAll');
    const who = all ? (req.query.assignee ? Number(req.query.assignee) : null) : user.id;
    const done = req.query.status === 'done';
    const tParams: unknown[] = [];
    const tWhere = ['t.is_visit', done ? `t.status <> 'open'` : `t.status = 'open'`];
    if (who) {
      tParams.push(who);
      tWhere.push(all ? `t.assignee_id = $1` : `(t.assignee_id = $1 OR t.creator_id = $1)`);
    }
    const tasks = await many(
      `${TASK_SELECT} WHERE ${tWhere.join(' AND ')} ORDER BY ${done ? 't.closed_at DESC NULLS LAST' : 't.due_at, t.id'} LIMIT 300`,
      tParams,
    );
    const plans = await many<ServicePlan>(
      `${SERVICE_PLAN_SELECT} WHERE p.is_active ${who ? 'AND p.assignee_id = $1' : ''} ORDER BY p.next_date, c.name`,
      who ? [who] : [],
    );
    const data: VisitsData = { tasks, plans: plans.map(withUpcoming) };
    res.json(data);
  }),
);

clientsRouter.get(
  '/clients/:id/service-plan',
  h(async (req, res) => {
    res.json({ plan: await getServicePlan(intParam(req.params.id)) });
  }),
);

clientsRouter.put(
  '/clients/:id/service-plan',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(servicePlanSchema, req.body);
    await tx(async (db) => {
      const c = await one('SELECT 1 FROM clients WHERE id = $1', [id], db);
      if (!c) throw new HttpError(404, 'Клиент не найден');
      await assertActiveUser(db, input.assigneeId);
      await db.query(
        `INSERT INTO service_plans (client_id, every_n, unit, next_date, visit_time, assignee_id, is_active, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
         ON CONFLICT (client_id) DO UPDATE SET every_n = $2, unit = $3, next_date = $4::date, visit_time = $5,
           assignee_id = $6, is_active = $7, created_by = $8, updated_at = now()`,
        [id, input.everyN, input.unit, input.nextDate, input.visitTime ?? null, input.assigneeId, input.isActive, req.user!.id],
      );
    });
    // если выезд сегодня или завтра — задача появится сразу
    await runServicePlans();
    broadcast('changed', { scopes: ['clients', 'tasks'] });
    res.json({ plan: await getServicePlan(id) });
  }),
);

clientsRouter.delete(
  '/clients/:id/service-plan',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    await one('DELETE FROM service_plans WHERE client_id = $1', [intParam(req.params.id)]);
    broadcast('changed', { scopes: ['clients'] });
    res.json({ ok: true });
  }),
);
