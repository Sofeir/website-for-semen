import { Router } from 'express';
import { actSchema, actTotal, can, formatOrderNumber, type Act, type ActInput } from '@sd/shared';
import { many, one, pool, tx, type Db } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';
import { DEVICE_TITLE, orderAccess } from '../services/sql';
import { assertOrderVisible } from '../services/access';

export const actsRouter = Router();

export async function loadAct(id: number, db: Db = pool): Promise<Act | null> {
  const a = await one(
    `SELECT a.id, a.number, a.order_id AS "orderId", o.number AS "orderNumber", o.client_id AS "clientId",
            c.name AS "clientName", ${DEVICE_TITLE} AS "deviceTitle",
            a.warranty_months AS "warrantyMonths", a.print_repeat_discount AS "printRepeatDiscount", a.note,
            a.created_at AS "createdAt", a.updated_at AS "updatedAt", u.full_name AS "createdByName"
       FROM acts a
       JOIN orders o ON o.id = a.order_id
       JOIN clients c ON c.id = o.client_id
       JOIN devices d ON d.id = o.device_id
       JOIN device_types dt ON dt.id = d.device_type_id
       LEFT JOIN brands b ON b.id = d.brand_id
       LEFT JOIN models m ON m.id = d.model_id
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.id = $1`,
    [id],
    db,
  );
  if (!a) return null;
  const items = await many(
    `SELECT id, service_id AS "serviceId", name, qty, price FROM act_items WHERE act_id = $1 ORDER BY sort, id`,
    [id],
    db,
  );
  return { ...a, items, total: actTotal(items) };
}

async function writeItems(db: Db, actId: number, items: ActInput['items']) {
  await db.query('DELETE FROM act_items WHERE act_id = $1', [actId]);
  let sort = 0;
  for (const it of items) {
    await db.query(`INSERT INTO act_items (act_id, service_id, name, qty, price, sort) VALUES ($1, $2, $3, $4, $5, $6)`, [
      actId,
      it.serviceId ?? null,
      it.name,
      it.qty,
      it.price,
      sort++,
    ]);
  }
}

actsRouter.get(
  '/acts',
  h(async (req, res) => {
    const params: unknown[] = [];
    const conds: string[] = [];
    if (req.query.order) {
      params.push(Number(req.query.order));
      conds.push(`a.order_id = $${params.length}`);
    }
    // мастер и диагност видят акты только по своим заявкам
    if (!can(req.user!.role, 'orders.viewAll')) {
      params.push(req.user!.id);
      conds.push(orderAccess('o', `$${params.length}`));
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await many(
      `SELECT a.id, a.number, a.created_at AS "createdAt", a.updated_at AS "updatedAt", a.order_id AS "orderId",
              o.number AS "orderNumber", c.name AS "clientName", ${DEVICE_TITLE} AS "deviceTitle",
              coalesce((SELECT sum(round(i.qty * i.price, 2)) FROM act_items i WHERE i.act_id = a.id), 0) AS total
         FROM acts a
         JOIN orders o ON o.id = a.order_id
         JOIN clients c ON c.id = o.client_id
         JOIN devices d ON d.id = o.device_id
         JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
         ${where} ORDER BY a.updated_at DESC LIMIT 200`,
      params,
    );
    res.json(rows);
  }),
);

actsRouter.get(
  '/acts/:id',
  h(async (req, res) => {
    const act = await loadAct(intParam(req.params.id));
    if (!act) throw new HttpError(404, 'Акт не найден');
    await assertOrderVisible(req.user!, act.orderId);
    res.json(act);
  }),
);

actsRouter.post(
  '/acts',
  requirePermission('acts.edit'),
  h(async (req, res) => {
    const input = parse(actSchema, req.body);
    await assertOrderVisible(req.user!, input.orderId);
    const id = await tx(async (db) => {
      const order = await one('SELECT id FROM orders WHERE id = $1', [input.orderId], db);
      if (!order) throw new HttpError(400, 'Заявка не найдена');
      const seq = await one<{ n: number }>(`SELECT nextval('act_number_seq') AS n`, [], db);
      const row = await one<{ id: number }>(
        `INSERT INTO acts (number, order_id, warranty_months, print_repeat_discount, note, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [formatOrderNumber(seq!.n), input.orderId, input.warrantyMonths, input.printRepeatDiscount, input.note, req.user!.id],
        db,
      );
      await writeItems(db, row!.id, input.items);
      return row!.id;
    });
    broadcast('changed', { scopes: ['orders', 'acts', 'clients'] });
    res.status(201).json(await loadAct(id));
  }),
);

/** Акт можно править и пересоздавать: PDF собирается заново из текущих данных. */
actsRouter.put(
  '/acts/:id',
  requirePermission('acts.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(actSchema, req.body);
    const existing = await loadAct(id);
    if (existing) await assertOrderVisible(req.user!, existing.orderId);
    await tx(async (db) => {
      const r = await db.query(
        `UPDATE acts SET warranty_months = $2, print_repeat_discount = $3, note = $4, updated_by = $5, updated_at = now()
          WHERE id = $1 AND order_id = $6`,
        [id, input.warrantyMonths, input.printRepeatDiscount, input.note, req.user!.id, input.orderId],
      );
      if (!r.rowCount) throw new HttpError(404, 'Акт не найден');
      await writeItems(db, id, input.items);
    });
    broadcast('changed', { scopes: ['orders', 'acts'] });
    res.json(await loadAct(id));
  }),
);

actsRouter.delete(
  '/acts/:id',
  requirePermission('acts.delete'),
  h(async (req, res) => {
    const r = await pool.query('DELETE FROM acts WHERE id = $1', [intParam(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Акт не найден');
    broadcast('changed', { scopes: ['orders', 'acts', 'clients'] });
    res.json({ ok: true });
  }),
);
