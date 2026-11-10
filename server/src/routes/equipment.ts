import { Router } from 'express';
import {
  can,
  clientDeviceSchema,
  deviceInfoSchema,
  deviceWorkSchema,
  INSPECTION_LABELS,
  inspectionKindOf,
  inspectionSchema,
  intakeSchema,
  type Device,
  type DeviceVisit,
  type DeviceWork,
  type Inspection,
  type VisitDevice,
} from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';
import { Outbox } from '../notify/notify';
import { assertClientWorksVisible, assertDeviceVisible, assertOrderVisible } from '../services/access';
import { createIntake } from '../services/orders';
import { DEVICE_SELECT, DEVICE_TITLE, orderAccess, WORK_SELECT } from '../services/sql';
import { assertActiveUser } from '../services/tasks';

export const equipmentRouter = Router();

/** Добавить технику в список клиента: компьютер или принтер, которые потом проверяют на выезде. */
equipmentRouter.post(
  '/clients/:id/devices',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const clientId = intParam(req.params.id);
    const input = parse(clientDeviceSchema, req.body);
    if (!(await one('SELECT 1 FROM clients WHERE id = $1', [clientId]))) throw new HttpError(404, 'Клиент не найден');
    const type = await one<{ name: string }>('SELECT name FROM device_types WHERE id = $1', [input.deviceTypeId]);
    if (!type) throw new HttpError(400, 'Выберите тип техники');
    if (input.inventoryNo) {
      const dup = await one('SELECT 1 FROM devices WHERE client_id = $1 AND lower(inventory_no) = lower($2)', [clientId, input.inventoryNo]);
      if (dup) throw new HttpError(409, 'Этот номер уже занят другой техникой клиента');
    }
    const row = await one<{ id: number }>(
      `INSERT INTO devices (client_id, device_type_id, model_text, serial, inventory_no, location, host_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [clientId, input.deviceTypeId, input.modelText, input.serial, input.inventoryNo, input.location, input.hostName],
    );
    broadcast('changed', { scopes: ['clients'] });
    res.status(201).json({ id: row!.id });
  }),
);

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

/** Все обращения с этой техникой: когда приносили, с каким пробегом, что нашли и чем закончилось. Самое свежее сверху. */
equipmentRouter.get(
  '/devices/:id/orders',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    await assertDeviceVisible(req.user!, id);
    // Чужие заявки по этому аппарату (к ним у сотрудника нет доступа) показываем урезанно: дата, пробег, неисправность и итог.
    // Диагноз, суммы, номер и имена остаются только у тех, кто видит саму заявку.
    const all = can(req.user!.role, 'orders.viewAll');
    const vis = `($3::boolean OR ${orderAccess('o', '$2')})`;
    res.json(
      await many<DeviceVisit>(
        `SELECT o.id AS "orderId", CASE WHEN ${vis} THEN o.number END AS number, ${vis} AS visible, o.created_at AS "createdAt",
                coalesce(nullif(concat_ws(', ',
                  (SELECT string_agg(f.name, ', ' ORDER BY f.sort, f.name) FROM faults f WHERE f.id = ANY (o.fault_ids)),
                  o.fault_text), ''), '—') AS fault,
                s.name AS "stageName", s.code AS "stageCode", o.outcome, o.issued_at AS "issuedAt",
                (SELECT w.counter FROM device_works w WHERE w.order_id = o.id AND w.counter IS NOT NULL ORDER BY w.done_at, w.id LIMIT 1) AS counter,
                CASE WHEN ${vis} THEN (SELECT h.comment FROM order_history h JOIN stages sh ON sh.id = h.stage_id
                  WHERE h.order_id = o.id AND h.kind = 'stage' AND sh.code <> 'diagnostics' AND coalesce(h.comment, '') <> ''
                    AND h.started_at > (SELECT max(h2.started_at) FROM order_history h2 JOIN stages s2 ON s2.id = h2.stage_id
                                         WHERE h2.order_id = o.id AND h2.kind = 'stage' AND s2.code = 'diagnostics')
                  ORDER BY h.started_at LIMIT 1) END AS diagnosis,
                CASE WHEN ${vis} THEN o.agreed_sum::float8 END AS "agreedSum",
                CASE WHEN ${vis} THEN (SELECT count(*)::int FROM device_works w WHERE w.order_id = o.id) ELSE 0 END AS "worksCount",
                CASE WHEN ${vis} THEN ua.full_name END AS "acceptedByName"
           FROM orders o JOIN stages s ON s.id = o.stage_id LEFT JOIN users ua ON ua.id = o.accepted_by
          WHERE o.device_id = $1 ORDER BY o.created_at DESC, o.id DESC`,
        [id, req.user!.id, all],
      ),
    );
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
    // Заправка без выбранной заявки: заводим новую заявку на клиента, чтобы заправка попала в общий список и отчёты.
    const makeOrder = input.newOrder && input.kind === 'refill' && !orderId && !deviceId;
    if (makeOrder && !can(req.user!.role, 'intake.create')) throw forbidden('Создавать заявки может сотрудник с правом приёма');
    const outbox = new Outbox();
    const saved = await tx(async (db) => {
      let linkOrderId = orderId;
      let linkDeviceId = deviceId;
      let orderNumber: string | null = null;
      if (makeOrder) {
        const client = await one<{ kind: 'person' | 'legal' }>('SELECT kind FROM clients WHERE id = $1', [clientId], db);
        if (!client) throw new HttpError(404, 'Клиент не найден');
        const type = await one<{ id: number }>(`SELECT id FROM device_types WHERE name = 'Картридж' AND is_active`, [], db);
        if (!type) throw new HttpError(400, 'В справочнике нет типа техники «Картридж»');
        const made = await createIntake(
          db,
          req.user!,
          intakeSchema.parse({
            clientKind: client.kind,
            clientId,
            devices: [
              {
                device: { deviceTypeId: type.id, modelText: input.title },
                faultText: `Заправка картриджей: ${input.qty} шт.`,
              },
            ],
            responsibleId: performerId,
            dueAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
            comment: input.note,
          }),
          outbox,
        );
        linkOrderId = made.orderIds[0];
        orderNumber = made.orderNumbers[0];
        linkDeviceId = (await one<{ device_id: number }>('SELECT device_id FROM orders WHERE id = $1', [linkOrderId], db))!.device_id;
      }
      const row = await one<{ id: number }>(
        `INSERT INTO device_works (client_id, device_id, order_id, kind, title, qty, counter, note, done_at, created_by,
                                   performer_id, amount, part_brand, part_spec, warranty_months, resource, ops)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        [
          clientId, linkDeviceId, linkOrderId, input.kind, input.title, input.qty, input.counter ?? null, input.note, input.doneAt ?? null, req.user!.id,
          performerId, input.amount ?? null, input.partBrand, input.partSpec, input.warrantyMonths ?? null, input.resource ?? null,
          input.kind === 'refill' ? input.ops : [],
        ],
        db,
      );
      return { id: row!.id, orderId: linkOrderId, orderNumber };
    });
    await outbox.flush();
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.status(201).json(saved);
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
         i.person_phone AS "personPhone", i.counter, i.note, i.items, i.task_id AS "taskId"
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

/** Задача-выезд, её клиент, исполнитель и роль постановщика. Клиент берётся из задачи или из её заявки. */
async function visitTask(taskId: number) {
  const t = await one<{
    id: number;
    isVisit: boolean;
    status: string;
    clientId: number | null;
    assigneeIds: number[];
    creatorRole: string | null;
  }>(
    `SELECT t.id, t.is_visit AS "isVisit", t.status, coalesce(t.client_id, o.client_id) AS "clientId",
            ARRAY(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id) AS "assigneeIds", cr.role AS "creatorRole"
       FROM tasks t
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN users cr ON cr.id = t.creator_id
      WHERE t.id = $1`,
    [taskId],
  );
  if (!t) throw new HttpError(404, 'Задача не найдена');
  if (!t.isVisit || !t.clientId) throw new HttpError(400, 'Это не выезд к клиенту');
  return t as typeof t & { clientId: number };
}

/**
 * Кто работает с техникой выезда: руководитель и администратор, а также нынешний исполнитель.
 * Выезд сам по себе не даёт доступа к чужому клиенту: если его поставил сотрудник без прав видеть всех клиентов
 * (например, инженер поставил выезд самому себе), исполнителю нужен обычный доступ к клиенту.
 * Прежние участники цепочки передачи доступ теряют.
 */
async function assertVisitAccess(actor: { id: number; role: string }, task: Awaited<ReturnType<typeof visitTask>>) {
  if (can(actor.role as never, 'orders.viewAll') || can(actor.role as never, 'tasks.manageAll')) return;
  if (!task.assigneeIds.includes(actor.id)) throw forbidden('Выезд ведёт другой сотрудник');
  if (task.creatorRole && can(task.creatorRole as never, 'orders.viewAll')) return;
  await assertClientWorksVisible(actor as never, task.clientId);
}

/**
 * Техника клиента в выезде: у каждого компьютера и принтера свой бланк. Видна исполнителю и постановщику выезда
 * (инженеру не нужны права на чужие заявки, чтобы проверить технику на своём выезде).
 */
equipmentRouter.get(
  '/tasks/:id/visit-devices',
  h(async (req, res) => {
    const taskId = intParam(req.params.id);
    const task = await visitTask(taskId);
    await assertVisitAccess(req.user!, task);
    const devices = await many<Device & { hostName?: string | null }>(
      `${DEVICE_SELECT} WHERE d.client_id = $1 ORDER BY d.location NULLS LAST, d.inventory_no NULLS LAST, d.id`,
      [task.clientId],
    );
    const hosts = new Map((await many<{ id: number; host: string | null }>('SELECT id, host_name AS host FROM devices WHERE client_id = $1', [task.clientId])).map((r) => [r.id, r.host]));
    const inspections = await many<Inspection>(`${INSPECTION_SELECT} WHERE i.client_id = $1 ORDER BY i.inspected_at DESC, i.id DESC LIMIT 1000`, [task.clientId]);
    const out: VisitDevice[] = [];
    for (const d of devices) {
      const kind = inspectionKindOf(d.deviceType);
      if (!kind) continue;
      const mine = inspections.filter((i) => i.deviceId === d.id);
      out.push({
        id: d.id,
        title: d.title,
        deviceType: d.deviceType,
        kind,
        inventoryNo: d.inventoryNo,
        location: d.location,
        hostName: hosts.get(d.id) ?? null,
        previous: mine[0] ?? null,
        current: mine.find((i) => i.taskId === taskId) ?? null,
      });
    }
    res.json(out);
  }),
);

const CLEANING = /очистк|чистк/i;

equipmentRouter.post(
  '/inspections',
  h(async (req, res) => {
    const input = parse(inspectionSchema, req.body);
    const d = await one<{ client_id: number; type: string }>(
      `SELECT d.client_id, dt.name AS type FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.id = $1`,
      [input.deviceId],
    );
    if (!d) throw new HttpError(404, 'Техника не найдена');
    if (input.taskId) {
      // Проверка в рамках выезда: можно исполнителю выезда, техника должна быть этого же клиента
      const task = await visitTask(input.taskId);
      await assertVisitAccess(req.user!, task);
      if (task.status !== 'open') throw new HttpError(409, 'Выезд закрыт. Верните его в работу, чтобы изменить проверку.');
      if (task.clientId !== d.client_id) throw new HttpError(400, 'Эта техника не относится к клиенту выезда');
    } else {
      if (!can(req.user!.role, 'workspace.view')) throw forbidden();
      await assertDeviceVisible(req.user!, input.deviceId);
    }
    const kind = inspectionKindOf(d.type);
    if (!kind) throw new HttpError(400, 'Для этой техники чек-листа нет. Проверка есть у компьютеров, ноутбуков, принтеров и МФУ.');
    const counter = kind === 'printer' ? (input.counter ?? null) : null;
    // пустые замечания не храним
    const items = input.items.map((i) => ({ title: i.title, done: i.done, ...(i.comment?.trim() ? { comment: i.comment.trim() } : {}) }));
    const done = items.filter((i) => i.done).length;
    const row = await tx(async (db) => {
      const r = await db.query(
        `INSERT INTO device_inspections (client_id, device_id, kind, performer_id, person_name, person_phone, counter, note, items, task_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          d.client_id,
          input.deviceId,
          kind,
          req.user!.id,
          input.personName,
          input.personPhone,
          counter,
          input.note,
          JSON.stringify(items),
          input.taskId ?? null,
        ],
      );
      if (input.hostName) await db.query('UPDATE devices SET host_name = $2 WHERE id = $1', [input.deviceId, input.hostName]);
      // В журнал техники: сама проверка (с пробегом принтера) и отдельной строкой каждая отмеченная очистка.
      const skipped = items.filter((i) => !i.done).map((i) => i.title);
      const remarks = items.filter((i) => i.comment).map((i) => `${i.title}: ${i.comment}`);
      const summary = [
        `Пройдено ${done} из ${items.length}`,
        skipped.length ? `не отмечено: ${skipped.join('; ')}` : null,
        remarks.length ? `замечания: ${remarks.join('; ')}` : null,
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
      for (const it of items) if (it.done && CLEANING.test(it.title)) await insertWork(it.title, it.comment ?? null, null);
      return r.rows[0] as { id: number };
    });
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.status(201).json({ id: row.id });
  }),
);
