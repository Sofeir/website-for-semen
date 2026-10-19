import { Router } from 'express';
import { can, deviceInfoSchema, deviceWorkSchema, type DeviceWork } from '@sd/shared';
import { many, one, pool } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';
import { assertOrderVisible } from '../services/access';

export const equipmentRouter = Router();

const WORK_SELECT = `
  SELECT w.id, w.client_id AS "clientId", w.device_id AS "deviceId", w.order_id AS "orderId", o.number AS "orderNumber",
         w.kind, w.title, w.qty, w.counter, w.note, w.done_at AS "doneAt", u.full_name AS "createdByName"
    FROM device_works w
    LEFT JOIN orders o ON o.id = w.order_id
    LEFT JOIN users u ON u.id = w.created_by`;

/** Паспорт техники: своя нумерация, место, серийный номер. */
equipmentRouter.put(
  '/devices/:id',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(deviceInfoSchema, req.body);
    const dup = input.inventoryNo
      ? await one(
          `SELECT 1 FROM devices WHERE client_id = (SELECT client_id FROM devices WHERE id = $1)
              AND lower(inventory_no) = lower($2) AND id <> $1`,
          [id, input.inventoryNo],
        )
      : null;
    if (dup) throw new HttpError(409, 'Этот номер уже занят другой техникой клиента');
    const r = await pool.query(
      'UPDATE devices SET inventory_no = $2, location = $3, serial = $4 WHERE id = $1',
      [id, input.inventoryNo, input.location, input.serial],
    );
    if (!r.rowCount) throw new HttpError(404, 'Техника не найдена');
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.json({ ok: true });
  }),
);

equipmentRouter.get(
  '/devices/:id/works',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    res.json(await many<DeviceWork>(`${WORK_SELECT} WHERE w.device_id = $1 ORDER BY w.done_at DESC, w.id DESC`, [id]));
  }),
);

/** Журнал клиента без привязки к технике: заправки картриджей и прочие расходники. */
equipmentRouter.get(
  '/clients/:id/works',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    res.json(await many<DeviceWork>(`${WORK_SELECT} WHERE w.client_id = $1 ORDER BY w.done_at DESC, w.id DESC LIMIT 200`, [id]));
  }),
);

equipmentRouter.post(
  '/works',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const input = parse(deviceWorkSchema, req.body);
    let clientId = input.clientId ?? null;
    let deviceId = input.deviceId ?? null;
    const orderId = input.orderId ?? null;
    if (orderId) {
      await assertOrderVisible(req.user!, orderId);
      const o = await one<{ client_id: number; device_id: number }>('SELECT client_id, device_id FROM orders WHERE id = $1', [orderId]);
      if (!o) throw new HttpError(404, 'Заявка не найдена');
      clientId = o.client_id;
      deviceId = deviceId ?? o.device_id;
    }
    if (deviceId) {
      const d = await one<{ client_id: number }>('SELECT client_id FROM devices WHERE id = $1', [deviceId]);
      if (!d) throw new HttpError(404, 'Техника не найдена');
      if (clientId && d.client_id !== clientId) throw new HttpError(400, 'Эта техника принадлежит другому клиенту');
      clientId = d.client_id;
    }
    if (!clientId) throw new HttpError(400, 'Не указан клиент');
    const row = await one<{ id: number }>(
      `INSERT INTO device_works (client_id, device_id, order_id, kind, title, qty, counter, note, done_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10) RETURNING id`,
      [clientId, deviceId, orderId, input.kind, input.title, input.qty, input.counter ?? null, input.note, input.doneAt ?? null, req.user!.id],
    );
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.status(201).json({ id: row!.id });
  }),
);

equipmentRouter.delete(
  '/works/:id',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const w = await one<{ created_by: number | null }>('SELECT created_by FROM device_works WHERE id = $1', [id]);
    if (!w) throw new HttpError(404, 'Запись не найдена');
    if (!(w.created_by === req.user!.id || can(req.user!.role, 'orders.viewAll'))) throw forbidden('Удалить может автор записи или руководитель');
    await pool.query('DELETE FROM device_works WHERE id = $1', [id]);
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.json({ ok: true });
  }),
);
