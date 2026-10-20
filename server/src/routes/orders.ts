import { Router } from 'express';
import {
  advanceOrderSchema,
  agreedSchema,
  can,
  intakeSchema,
  reassignOrderSchema,
  reopenOrderSchema,
  type Contact,
  type DeviceWork,
  type OrderDetail,
} from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { Outbox } from '../notify/notify';
import {
  activeStages,
  advanceOrder,
  canAdvanceOrder,
  createIntake,
  nextStageOf,
  reassignOrder,
  reopenOrder,
} from '../services/orders';
import { DEVICE_SELECT, likeEscape, ORDER_SELECT, orderAccess, TASK_SELECT, WORK_SELECT } from '../services/sql';
import { assertOrderVisible } from '../services/access';

export const ordersRouter = Router();

ordersRouter.get(
  '/orders',
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: (p: string) => string, v: unknown) => {
      params.push(v);
      where.push(sql(`$${params.length}`));
    };
    if (!can(req.user!.role, 'orders.viewAll')) add((p) => orderAccess('o', p), req.user!.id);
    if (req.query.stage) add((p) => `o.stage_id = ${p}`, Number(req.query.stage));
    if (req.query.responsible) add((p) => `o.responsible_id = ${p}`, Number(req.query.responsible));
    if (req.query.mine === '1') add((p) => `o.responsible_id = ${p}`, req.user!.id);
    if (req.query.kind === 'person' || req.query.kind === 'legal') add((p) => `c.kind = ${p}`, req.query.kind);
    if (req.query.client) add((p) => `o.client_id = ${p}`, Number(req.query.client));
    if (req.query.overdue === '1') where.push(`o.stage_due_at < now() AND NOT s.is_final`);
    // По умолчанию выданные показываем только за последние 14 дней, чтобы список не разрастался.
    if (req.query.issued === 'all') {
      /* все */
    } else if (req.query.issued === 'only') where.push('s.is_final');
    else where.push(`(NOT s.is_final OR o.issued_at > now() - interval '14 days')`);
    if (q) {
      params.push(`%${likeEscape(q)}%`);
      const p = `$${params.length}`;
      where.push(
        `(o.number ILIKE ${p} OR c.name ILIKE ${p} OR c.phone_digits LIKE ${p} OR d.serial ILIKE ${p}
          OR coalesce(b.name, d.brand_text) ILIKE ${p} OR coalesce(m.name, d.model_text) ILIKE ${p} OR o.fault_text ILIKE ${p}
          OR d.inventory_no ILIKE ${p} OR d.location ILIKE ${p} OR o.requester_name ILIKE ${p} OR o.branch ILIKE ${p}
          OR c.contact_person ILIKE ${p} OR c.inn ILIKE ${p}
          OR EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.client_id = c.id AND (cc.full_name ILIKE ${p} OR cc.phone_digits LIKE ${p})))`,
      );
    }
    const limit = Math.min(Number(req.query.limit) || 300, 500);
    params.push(limit);
    const sort =
      req.query.sort === 'due'
        ? 'o.stage_due_at NULLS LAST, o.id'
        : req.query.sort === 'old'
          ? 'o.created_at, o.id'
          : 'o.created_at DESC, o.id DESC';
    const rows = await many(
      `${ORDER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort} LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  }),
);

ordersRouter.get(
  '/orders/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const order = await one(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
    if (!order) throw new HttpError(404, 'Заявка не найдена');
    await assertOrderVisible(req.user!, id);
    const raw = (await one(`SELECT * FROM orders WHERE id = $1`, [id]))!;
    const stages = await activeStages(pool);
    const [device, history, attachments, acts, tasks, accepted, contact, works] = await Promise.all([
      one(`${DEVICE_SELECT} WHERE d.id = $1`, [raw.device_id]),
      many(
        `SELECT h.id, h.kind, h.stage_id AS "stageId", s.name AS "stageName", s.code AS "stageCode",
                h.responsible_id AS "responsibleId", u.full_name AS "responsibleName", f.full_name AS "fromUserName",
                h.started_at AS "startedAt", h.due_at AS "dueAt", h.finished_at AS "finishedAt", h.comment
           FROM order_history h JOIN stages s ON s.id = h.stage_id
           LEFT JOIN users u ON u.id = h.responsible_id LEFT JOIN users f ON f.id = h.from_user_id
          WHERE h.order_id = $1 ORDER BY h.started_at, h.id`,
        [id],
      ),
      many(
        `SELECT a.id, a.file_name AS "fileName", a.mime, a.size, a.created_at AS "createdAt", u.full_name AS "uploadedBy",
                '/api/files/' || a.id AS url
           FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.order_id = $1 ORDER BY a.created_at`,
        [id],
      ),
      many(
        `SELECT a.id, a.number, a.created_at AS "createdAt", a.updated_at AS "updatedAt", a.order_id AS "orderId",
                o.number AS "orderNumber", '' AS "clientName", '' AS "deviceTitle",
                coalesce((SELECT sum(round(i.qty * i.price, 2)) FROM act_items i WHERE i.act_id = a.id), 0) AS total
           FROM acts a JOIN orders o ON o.id = a.order_id WHERE a.order_id = $1 ORDER BY a.created_at`,
        [id],
      ),
      many(`${TASK_SELECT} WHERE t.order_id = $1 ORDER BY t.created_at`, [id]),
      one(`SELECT full_name FROM users WHERE id = $1`, [raw.accepted_by]),
      raw.contact_id
        ? one<Contact>(
            `SELECT c.id, c.client_id AS "clientId", c.full_name AS "fullName", c.phone, c.position, c.person_client_id AS "personClientId"
               FROM client_contacts c WHERE c.id = $1`,
            [raw.contact_id],
          )
        : Promise.resolve(null),
      many<DeviceWork>(`${WORK_SELECT} WHERE w.order_id = $1 ORDER BY w.done_at, w.id`, [id]),
    ]);
    const next = nextStageOf(stages, raw.stage_id);
    const detail: OrderDetail = {
      ...order,
      device,
      faultIds: raw.fault_ids,
      appearance: raw.appearance,
      appearanceNote: raw.appearance_note,
      kit: raw.kit,
      kitNote: raw.kit_note,
      devicePassword: raw.device_password,
      department: raw.department,
      branch: raw.branch,
      requesterName: raw.requester_name,
      contact: contact ?? null,
      agreedTerm: raw.agreed_term,
      agreedSum: raw.agreed_sum == null ? null : Number(raw.agreed_sum),
      works,
      deviceReturnedAt: raw.device_returned_at,
      outcome: raw.outcome,
      reopenCount: raw.reopen_count,
      canReopen:
        Boolean(raw.issued_at) &&
        (can(req.user!.role, 'orders.advanceAny') || raw.responsible_id === req.user!.id || raw.accepted_by === req.user!.id),
      comment: raw.comment,
      estimatedCost: raw.estimated_cost,
      acceptedByName: accepted?.full_name ?? null,
      history,
      attachments,
      acts,
      tasks,
      batchId: raw.batch_id,
      receiptUrl: raw.batch_id ? `/api/documents/receipt/${raw.batch_id}.pdf` : '',
      nextStage: next,
      canAdvance: Boolean(next) && canAdvanceOrder(req.user!, raw),
    };
    res.json(detail);
  }),
);

ordersRouter.post(
  '/intake',
  requirePermission('intake.create'),
  h(async (req, res) => {
    const input = parse(intakeSchema, req.body);
    const outbox = new Outbox();
    const result = await tx((db) => createIntake(db, req.user!, input, outbox));
    await outbox.flush();
    res.status(201).json(result);
  }),
);

ordersRouter.post(
  '/orders/:id/advance',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(advanceOrderSchema, req.body);
    const outbox = new Outbox();
    const stage = await tx((db) => advanceOrder(db, req.user!, id, input, outbox));
    await outbox.flush();
    res.json({ ok: true, stage });
  }),
);

ordersRouter.post(
  '/orders/:id/reassign',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(reassignOrderSchema, req.body);
    const outbox = new Outbox();
    await tx((db) => reassignOrder(db, req.user!, id, input, outbox));
    await outbox.flush();
    res.json({ ok: true });
  }),
);

ordersRouter.post(
  '/orders/:id/reopen',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(reopenOrderSchema, req.body);
    const outbox = new Outbox();
    await tx((db) => reopenOrder(db, req.user!, id, input, outbox));
    await outbox.flush();
    res.json({ ok: true });
  }),
);

/** Что согласовали с клиентом: срок текстом и сумма. Правит ответственный или руководитель. */
ordersRouter.put(
  '/orders/:id/agreed',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const raw = await one<{ responsible_id: number | null }>('SELECT responsible_id FROM orders WHERE id = $1', [id]);
    if (!raw) throw new HttpError(404, 'Заявка не найдена');
    if (!(can(req.user!.role, 'orders.assign') || raw.responsible_id === req.user!.id)) {
      throw new HttpError(403, 'Править согласованное может ответственный или руководитель');
    }
    const input = parse(agreedSchema, req.body);
    await pool.query('UPDATE orders SET agreed_term = $2, agreed_sum = $3, updated_at = now() WHERE id = $1', [
      id,
      input.agreedTerm,
      input.agreedSum ?? null,
    ]);
    res.json({ ok: true });
  }),
);

/** Пароль устройства, заметки и примерная стоимость правятся без смены этапа. */
ordersRouter.patch(
  '/orders/:id',
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const raw = await one<{ responsible_id: number | null }>('SELECT responsible_id FROM orders WHERE id = $1', [id]);
    if (!raw) throw new HttpError(404, 'Заявка не найдена');
    if (!(can(req.user!.role, 'orders.assign') || raw.responsible_id === req.user!.id)) {
      throw new HttpError(403, 'Править заявку может ответственный или руководитель');
    }
    const body = req.body ?? {};
    const cost = body.estimatedCost === '' || body.estimatedCost == null ? null : Number(body.estimatedCost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new HttpError(400, 'Стоимость — неотрицательное число');
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) || null : undefined;
    await many(`UPDATE orders SET estimated_cost = $2, comment = coalesce($3, comment), updated_at = now() WHERE id = $1`, [
      id,
      cost,
      comment ?? null,
    ]);
    res.json({ ok: true });
  }),
);
