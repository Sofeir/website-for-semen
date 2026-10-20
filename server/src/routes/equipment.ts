import { Router } from 'express';
import { can, deviceInfoSchema, deviceWorkSchema, type Device, type DeviceWork } from '@sd/shared';
import { many, one, pool } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';
import { assertClientWorksVisible, assertDeviceVisible, assertOrderVisible } from '../services/access';
import { DEVICE_SELECT, WORK_SELECT } from '../services/sql';
import { assertActiveUser } from '../services/tasks';

export const equipmentRouter = Router();

/** Паспорт техники: своя нумерация, место, серийный номер. */
equipmentRouter.put(
  '/devices/:id',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertDeviceVisible(req.user!, id);
    const input = parse(deviceInfoSchema, req.body);
    const dup = input.inventoryNo
      ? await one(
          `SELECT 1 FROM devices WHERE client_id = (SELECT client_id FROM devices WHERE id = $1)
              AND lower(inventory_no) = lower($2) AND id <> $1`,
          [id, input.inventoryNo],
        )
      : null;
    if (dup) throw new HttpError(409, 'Этот номер уже занят другой техникой клиента');
    if (input.parentId) {
      if (input.parentId === id) throw new HttpError(400, 'Техника не может входить сама в себя');
      const parent = await one<{ client_id: number; parent_id: number | null }>(
        'SELECT client_id, parent_id FROM devices WHERE id = $1',
        [input.parentId],
      );
      const own = await one<{ client_id: number }>('SELECT client_id FROM devices WHERE id = $1', [id]);
      if (!parent || !own) throw new HttpError(404, 'Техника не найдена');
      if (parent.client_id !== own.client_id) throw new HttpError(400, 'Рабочее место собирается из техники одного клиента');
      if (parent.parent_id) throw new HttpError(400, 'Комплектующее нельзя сделать основной техникой другого комплектующего');
    }
    const r = await pool.query(
      'UPDATE devices SET inventory_no = $2, location = $3, serial = $4, parent_id = $5 WHERE id = $1',
      [id, input.inventoryNo, input.location, input.serial, input.parentId ?? null],
    );
    if (!r.rowCount) throw new HttpError(404, 'Техника не найдена');
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.json({ ok: true });
  }),
);

/** Рабочее место: техника, входящая в состав этой (монитор, клавиатура, мышь). */
equipmentRouter.get(
  '/devices/:id/components',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertDeviceVisible(req.user!, id);
    res.json(await many<Device>(`${DEVICE_SELECT} WHERE d.parent_id = $1 ORDER BY d.id`, [id]));
  }),
);

/** Новое комплектующее в состав рабочего места: тип и модель вручную. */
equipmentRouter.post(
  '/devices/:id/components',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertDeviceVisible(req.user!, id);
    const parent = await one<{ client_id: number; parent_id: number | null }>('SELECT client_id, parent_id FROM devices WHERE id = $1', [id]);
    if (!parent) throw new HttpError(404, 'Техника не найдена');
    if (parent.parent_id) throw new HttpError(400, 'Комплектующее само комплектующих не имеет');
    const body = req.body ?? {};
    const typeId = Number(body.deviceTypeId);
    const model = typeof body.modelText === 'string' ? body.modelText.trim().slice(0, 150) : '';
    const serial = typeof body.serial === 'string' ? body.serial.trim().slice(0, 100) || null : null;
    if (!Number.isInteger(typeId) || typeId <= 0) throw new HttpError(400, 'Выберите тип');
    if (model.length < 2) throw new HttpError(400, 'Напишите модель, например: монитор 27" Samsung');
    const type = await one('SELECT 1 FROM device_types WHERE id = $1', [typeId]);
    if (!type) throw new HttpError(400, 'Такого типа нет');
    const row = await one<{ id: number }>(
      `INSERT INTO devices (client_id, device_type_id, model_text, serial, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parent.client_id, typeId, model, serial, id],
    );
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.status(201).json({ id: row!.id });
  }),
);

equipmentRouter.get(
  '/devices/:id/works',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertDeviceVisible(req.user!, id);
    res.json(await many<DeviceWork>(`${WORK_SELECT} WHERE w.device_id = $1 ORDER BY w.done_at DESC, w.id DESC`, [id]));
  }),
);

/** Журнал клиента без привязки к технике: заправки картриджей и прочие расходники. */
equipmentRouter.get(
  '/clients/:id/works',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertClientWorksVisible(req.user!, id);
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
      await assertDeviceVisible(req.user!, deviceId);
      if (clientId && d.client_id !== clientId) throw new HttpError(400, 'Эта техника принадлежит другому клиенту');
      clientId = d.client_id;
    }
    if (!clientId) throw new HttpError(400, 'Не указан клиент');
    const performerId = input.performerId ? (await assertActiveUser(pool, input.performerId)).id : req.user!.id;
    const row = await one<{ id: number }>(
      `INSERT INTO device_works (client_id, device_id, order_id, kind, title, qty, counter, note, done_at, created_by,
                                 performer_id, amount, part_brand, part_spec, warranty_months, resource, ops)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [
        clientId, deviceId, orderId, input.kind, input.title, input.qty, input.counter ?? null, input.note, input.doneAt ?? null, req.user!.id,
        performerId, input.amount ?? null, input.partBrand, input.partSpec, input.warrantyMonths ?? null, input.resource ?? null,
        input.kind === 'refill' ? input.ops : [],
      ],
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
