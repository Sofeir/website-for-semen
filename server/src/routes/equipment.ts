import { Router } from 'express';
import {
  can,
  deviceInfoSchema,
  deviceWorkSchema,
  INSPECTION_LABELS,
  inspectionKindOf,
  inspectionSchema,
  type Device,
  type DeviceWork,
  type Inspection,
} from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';
import { assertClientWorksVisible, assertDeviceVisible, assertOrderVisible } from '../services/access';
import { DEVICE_SELECT, DEVICE_TITLE, WORK_SELECT } from '../services/sql';
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

// ---------- Проверка техники на выезде ----------

const INSPECTION_SELECT = `
  SELECT i.id, i.client_id AS "clientId", i.device_id AS "deviceId", i.kind, ${DEVICE_TITLE} AS "deviceTitle", dt.name AS "deviceType",
         d.inventory_no AS "inventoryNo", d.location, d.host_name AS "hostName", i.inspected_at AS "inspectedAt",
         i.performer_id AS "performerId", u.full_name AS "performerName", i.person_name AS "personName",
         i.person_phone AS "personPhone", i.counter, i.note, i.items
    FROM device_inspections i
    JOIN devices d ON d.id = i.device_id
    JOIN device_types dt ON dt.id = d.device_type_id
    LEFT JOIN brands b ON b.id = d.brand_id
    LEFT JOIN models m ON m.id = d.model_id
    LEFT JOIN users u ON u.id = i.performer_id`;

export { INSPECTION_SELECT };

/** Проверки клиента: по ним видно, какая техника уже проверена и кто за ней сидит. */
equipmentRouter.get(
  '/clients/:id/inspections',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertClientWorksVisible(req.user!, id);
    res.json(await many<Inspection>(`${INSPECTION_SELECT} WHERE i.client_id = $1 ORDER BY i.inspected_at DESC, i.id DESC LIMIT 500`, [id]));
  }),
);

const CLEANING = /очистк|чистк/i;

equipmentRouter.post(
  '/inspections',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const input = parse(inspectionSchema, req.body);
    await assertDeviceVisible(req.user!, input.deviceId);
    const d = await one<{ client_id: number; type: string }>(
      `SELECT d.client_id, dt.name AS type FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.id = $1`,
      [input.deviceId],
    );
    if (!d) throw new HttpError(404, 'Техника не найдена');
    const kind = inspectionKindOf(d.type);
    if (!kind) throw new HttpError(400, 'Для этой техники чек-листа нет. Проверка есть у компьютеров, ноутбуков, принтеров и МФУ.');
    const counter = kind === 'printer' ? (input.counter ?? null) : null;
    const done = input.items.filter((i) => i.done).length;
    const row = await tx(async (db) => {
      const r = await db.query(
        `INSERT INTO device_inspections (client_id, device_id, kind, performer_id, person_name, person_phone, counter, note, items)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [d.client_id, input.deviceId, kind, req.user!.id, input.personName, input.personPhone, counter, input.note, JSON.stringify(input.items)],
      );
      if (input.hostName) await db.query('UPDATE devices SET host_name = $2 WHERE id = $1', [input.deviceId, input.hostName]);
      // В журнал техники: сама проверка (с пробегом принтера) и отдельной строкой каждая отмеченная очистка.
      const skipped = input.items.filter((i) => !i.done).map((i) => i.title);
      const summary = [
        `Пройдено ${done} из ${input.items.length}`,
        skipped.length ? `не отмечено: ${skipped.join('; ')}` : null,
        input.note,
      ]
        .filter(Boolean)
        .join('. ');
      const insertWork = (title: string, note: string | null, cnt: number | null) =>
        db.query(
          `INSERT INTO device_works (client_id, device_id, kind, title, qty, counter, note, created_by, performer_id)
           VALUES ($1, $2, 'service', $3, 1, $4, $5, $6, $6)`,
          [d.client_id, input.deviceId, title, cnt, note, req.user!.id],
        );
      await insertWork(INSPECTION_LABELS[kind], summary, counter);
      for (const it of input.items) if (it.done && CLEANING.test(it.title)) await insertWork(it.title, null, null);
      return r.rows[0] as { id: number };
    });
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.status(201).json({ id: row.id });
  }),
);
