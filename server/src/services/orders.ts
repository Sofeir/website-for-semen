import {
  can,
  formatOrderNumber,
  type AdvanceOrderInput,
  type ReopenOrderInput,
  type IntakeInput,
  type IntakeResult,
  type ReassignOrderInput,
  type Stage,
} from '@sd/shared';
import { many, one, type Db } from '../db/pool';
import { forbidden, HttpError } from '../lib/http';
import type { Outbox } from '../notify/notify';
import { createClient, replaceFleet } from './clients';
import { getWorkSettings } from './settings';
import { DEVICE_TITLE } from './sql';
import { assertActiveUser, closeTasks, createTask, normalizeDue, notifyHandover, type Actor } from './tasks';
import { defaultDue, formatDateTimeRu } from './workTime';

export async function activeStages(db: Db): Promise<Stage[]> {
  return many<Stage>(
    `SELECT id, code, name, sort, color, sla_hours AS "slaHours", is_final AS "isFinal", is_active AS "isActive"
       FROM stages WHERE is_active ORDER BY sort, id`,
    [],
    db,
  );
}

/** Следующий допустимый этап. Перескакивать и возвращаться нельзя. */
export function nextStageOf(stages: Stage[], currentId: number): Stage | null {
  const idx = stages.findIndex((s) => s.id === currentId);
  if (idx < 0) return null;
  return stages[idx + 1] ?? null;
}

/** Предпоследний этап («Готово») — о нём сообщаем приёмщику. */
export function isReadyStage(stages: Stage[], stageId: number) {
  const idx = stages.findIndex((s) => s.id === stageId);
  return idx >= 0 && idx === stages.length - 2;
}

export function canAdvanceOrder(actor: Actor, order: { responsible_id: number | null }) {
  return can(actor.role, 'orders.advanceAny') || order.responsible_id === actor.id;
}

async function deviceTitle(db: Db, deviceId: number) {
  const r = await one<{ title: string }>(
    `SELECT ${DEVICE_TITLE} AS title FROM devices d
       JOIN device_types dt ON dt.id = d.device_type_id
       LEFT JOIN brands b ON b.id = d.brand_id
       LEFT JOIN models m ON m.id = d.model_id
      WHERE d.id = $1`,
    [deviceId],
    db,
  );
  return r?.title ?? 'Техника';
}

const stageTaskTitle = (stage: Stage, title: string, number: string) => `${stage.name}: ${title}, №${number}`;

/**
 * Приём техники. Одна транзакция: клиент (новый или найденный), техника, заявки,
 * этап «Приём» закрыт сразу, заявка уходит на следующий этап с задачей ответственному.
 */
export async function createIntake(db: Db, actor: Actor, input: IntakeInput, outbox: Outbox): Promise<IntakeResult> {
  let clientId = input.clientId ?? null;
  if (clientId) {
    const c = await one('SELECT id FROM clients WHERE id = $1', [clientId], db);
    if (!c) throw new HttpError(400, 'Клиент не найден');
  } else {
    clientId = await createClient(db, actor.id, { ...input.newClient!, kind: input.clientKind });
  }
  const client = (await one<{ name: string; kind: string }>('SELECT name, kind FROM clients WHERE id = $1', [clientId], db))!;

  if (input.fleet && client.kind === 'legal') await replaceFleet(db, clientId, input.fleet);

  const stages = await activeStages(db);
  if (stages.length < 3) throw new HttpError(500, 'В справочнике меньше трёх активных этапов');
  const [entry, work] = stages;
  const responsible = await assertActiveUser(db, input.responsibleId);
  const due = await normalizeDue(db, input.dueAt);

  const batch = await one<{ id: number }>(
    'INSERT INTO intake_batches (client_id, comment, created_by) VALUES ($1, $2, $3) RETURNING id',
    [clientId, input.comment, actor.id],
    db,
  );

  const orderIds: number[] = [];
  const orderNumbers: string[] = [];
  for (const item of input.devices) {
    const dv = item.device;
    let deviceId: number;
    if (dv.id) {
      const existing = await one<{ id: number }>(
        'SELECT id FROM devices WHERE id = $1 AND client_id = $2',
        [dv.id, clientId],
        db,
      );
      if (!existing) throw new HttpError(400, 'Эта техника принадлежит другому клиенту');
      deviceId = existing.id;
      if (dv.serial) await db.query('UPDATE devices SET serial = $2 WHERE id = $1 AND serial IS NULL', [deviceId, dv.serial]);
    } else {
      const row = await one<{ id: number }>(
        `INSERT INTO devices (client_id, device_type_id, brand_id, brand_text, model_id, model_text, serial)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          clientId,
          dv.deviceTypeId,
          dv.brandId ?? null,
          dv.brandId ? null : dv.brandText,
          dv.modelId ?? null,
          dv.modelId ? null : dv.modelText,
          dv.serial,
        ],
        db,
      );
      deviceId = row!.id;
    }

    const seq = await one<{ n: number }>(`SELECT nextval('order_number_seq') AS n`, [], db);
    const number = formatOrderNumber(seq!.n);
    const order = await one<{ id: number }>(
      `INSERT INTO orders (number, batch_id, client_id, device_id, stage_id, responsible_id, stage_due_at,
                           fault_ids, fault_text, appearance, appearance_note, kit, kit_note, device_password,
                           department, comment, accepted_by, branch, requester_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [
        number,
        batch!.id,
        clientId,
        deviceId,
        work.id,
        responsible.id,
        due,
        item.faultIds,
        item.faultText,
        item.appearance,
        item.appearanceNote,
        item.kit,
        item.kitNote,
        item.devicePassword,
        item.department,
        input.comment,
        actor.id,
        input.branch,
        input.requesterName,
      ],
      db,
    );
    const orderId = order!.id;
    await db.query(
      `INSERT INTO order_history (order_id, stage_id, responsible_id, started_at, finished_at, comment)
       VALUES ($1, $2, $3, now(), now(), 'Техника принята')`,
      [orderId, entry.id, actor.id],
    );
    await db.query(
      `INSERT INTO order_history (order_id, stage_id, responsible_id, from_user_id, due_at) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, work.id, responsible.id, actor.id, due],
    );
    const title = await deviceTitle(db, deviceId);
    await createTask(
      db,
      actor,
      {
        title: stageTaskTitle(work, title, number),
        description: `Клиент: ${client.name}.`,
        assigneeId: responsible.id,
        orderId,
        clientId,
        startAt: new Date().toISOString(),
        dueAt: due.toISOString(),
        deadlineAt: null,
        stageId: work.id,
      },
      outbox,
    );
    orderIds.push(orderId);
    orderNumbers.push(number);
  }

  if (input.attachmentIds.length) {
    await db.query(
      `UPDATE attachments SET order_id = $1, client_id = $2
        WHERE id = ANY ($3) AND uploaded_by = $4 AND order_id IS NULL`,
      [orderIds[0], clientId, input.attachmentIds, actor.id],
    );
  }

  outbox.touch('orders', 'clients', 'dashboard');
  return { batchId: batch!.id, orderIds, orderNumbers, receiptUrl: `/api/documents/receipt/${batch!.id}.pdf` };
}

interface OrderRow {
  id: number;
  number: string;
  stage_id: number;
  responsible_id: number | null;
  accepted_by: number | null;
  device_id: number;
  client_id: number;
}

async function lockOrder(db: Db, id: number) {
  const o = await one<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id], db);
  if (!o) throw new HttpError(404, 'Заявка не найдена');
  return o;
}

export async function advanceOrder(db: Db, actor: Actor, orderId: number, input: AdvanceOrderInput, outbox: Outbox) {
  const order = await lockOrder(db, orderId);
  const stages = await activeStages(db);
  const current = stages.find((s) => s.id === order.stage_id);
  if (current?.isFinal) throw new HttpError(409, 'Заявка уже выдана');
  let next = nextStageOf(stages, order.stage_id);
  if (!next) throw new HttpError(409, 'Дальше этапов нет');
  if (input.declined) {
    // Заказчик не согласовал ремонт: из «Согласования» сразу в «Готово», этап ремонта пропускаем.
    if (current?.code !== 'approval') throw new HttpError(409, 'Отказ без ремонта возможен только на согласовании');
    next = nextStageOf(stages, next.id);
    if (!next) throw new HttpError(409, 'Дальше этапов нет');
  }
  if (next.isFinal && !input.deviceReturned) {
    throw new HttpError(400, 'Отметьте, что техника возвращена клиенту, иначе заявку закрыть нельзя');
  }
  if (input.toStageId !== next.id) {
    throw new HttpError(409, `Этапы идут строго по порядку: следующий — «${next.name}».`, { nextStageId: next.id });
  }
  if (!canAdvanceOrder(actor, order)) throw forbidden('Перевести заявку может ответственный или руководитель');

  const responsible = await assertActiveUser(db, input.responsibleId);
  const ws = await getWorkSettings(db);
  const due = next.isFinal ? null : await normalizeDue(db, input.dueAt ?? defaultDue(ws).toISOString());

  // Закрываем текущий этап и его задачу. Если задачу ставил другой сотрудник, он получит уведомление.
  await db.query('UPDATE order_history SET finished_at = now() WHERE order_id = $1 AND finished_at IS NULL', [orderId]);
  const openStageTasks = await many<{ id: number }>(
    `SELECT id FROM tasks WHERE order_id = $1 AND stage_id IS NOT NULL AND status = 'open'`,
    [orderId],
    db,
  );
  if (openStageTasks.length) {
    await closeTasks(
      db,
      actor,
      openStageTasks.map((t) => t.id),
      input.comment,
      outbox,
    );
  }

  await db.query(
    `INSERT INTO order_history (order_id, stage_id, responsible_id, from_user_id, due_at, comment, finished_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      orderId,
      next.id,
      responsible.id,
      actor.id,
      due,
      input.comment,
      next.isFinal ? new Date() : null,
      next.code === 'ready' ? (input.declined ? 'declined' : 'repaired') : null,
    ],
  );
  await db.query(
    `UPDATE orders SET stage_id = $2, responsible_id = $3, stage_started_at = now(), stage_due_at = $4,
            estimated_cost = coalesce($5, estimated_cost), updated_at = now(),
            issued_at = CASE WHEN $6 THEN now() ELSE issued_at END,
            device_returned_at = CASE WHEN $6 THEN now() ELSE device_returned_at END,
            outcome = CASE WHEN $7 THEN 'declined' WHEN $8 THEN 'repaired' ELSE outcome END
      WHERE id = $1`,
    [
      orderId,
      next.id,
      responsible.id,
      due,
      input.estimatedCost ?? null,
      next.isFinal,
      Boolean(input.declined),
      next.code === 'ready' && !input.declined,
    ],
  );

  const title = await deviceTitle(db, order.device_id);
  if (!next.isFinal) {
    await createTask(
      db,
      actor,
      {
        title: stageTaskTitle(next, title, order.number),
        description: input.comment,
        assigneeId: responsible.id,
        orderId,
        clientId: order.client_id,
        startAt: new Date().toISOString(),
        dueAt: due!.toISOString(),
        deadlineAt: null,
        stageId: next.id,
      },
      outbox,
    );
  }
  if (
    isReadyStage(stages, next.id) &&
    order.accepted_by &&
    order.accepted_by !== actor.id &&
    order.accepted_by !== responsible.id
  ) {
    outbox.add({
      userId: order.accepted_by,
      type: 'order_ready',
      title: `Готово к выдаче: №${order.number}`,
      body: `${title}. Можно звонить клиенту.`,
      link: `/orders/${orderId}`,
    });
  }
  outbox.touch('orders', 'dashboard', 'clients');
  return next;
}

/** Передача заявки другому сотруднику без смены этапа (например, диагност → мастер). */
export async function reassignOrder(db: Db, actor: Actor, orderId: number, input: ReassignOrderInput, outbox: Outbox) {
  const order = await lockOrder(db, orderId);
  if (!(can(actor.role, 'orders.assign') || order.responsible_id === actor.id)) {
    throw forbidden('Передать заявку может ответственный или руководитель');
  }
  if (order.responsible_id === input.responsibleId) throw new HttpError(400, 'Заявка уже у этого сотрудника');
  const stage = await one<{ is_final: boolean; name: string }>(
    'SELECT is_final, name FROM stages WHERE id = $1',
    [order.stage_id],
    db,
  );
  if (stage?.is_final) throw new HttpError(409, 'Заявка уже выдана');
  const responsible = await assertActiveUser(db, input.responsibleId);
  const due = input.dueAt
    ? await normalizeDue(db, input.dueAt)
    : (await one<{ d: Date }>('SELECT stage_due_at AS d FROM orders WHERE id = $1', [orderId], db))!.d;

  await db.query('UPDATE order_history SET finished_at = now() WHERE order_id = $1 AND finished_at IS NULL', [orderId]);
  await db.query(
    `INSERT INTO order_history (order_id, kind, stage_id, responsible_id, from_user_id, due_at, comment)
     VALUES ($1, 'transfer', $2, $3, $4, $5, $6)`,
    [orderId, order.stage_id, responsible.id, actor.id, due, input.comment],
  );
  await db.query(`UPDATE orders SET responsible_id = $2, stage_due_at = $3, updated_at = now() WHERE id = $1`, [
    orderId,
    responsible.id,
    due,
  ]);

  // Задача этапа переходит вместе с заявкой — с новым шагом в цепочке.
  const task = await one<{ id: number; title: string }>(
    `SELECT id, title FROM tasks WHERE order_id = $1 AND stage_id = $2 AND status = 'open' ORDER BY id DESC LIMIT 1`,
    [orderId, order.stage_id],
    db,
  );
  if (task) {
    await db.query(`UPDATE task_steps SET done_at = now() WHERE task_id = $1 AND done_at IS NULL`, [task.id]);
    await db.query(`INSERT INTO task_steps (task_id, assignee_id, from_user_id, due_at, comment) VALUES ($1, $2, $3, $4, $5)`, [
      task.id,
      responsible.id,
      actor.id,
      due,
      input.comment,
    ]);
    await db.query(`UPDATE tasks SET assignee_id = $2, due_at = $3, overdue_notified_at = NULL, updated_at = now() WHERE id = $1`, [
      task.id,
      responsible.id,
      due,
    ]);
  }
  const handoverTitle = await deviceTitle(db, order.device_id);
  await notifyHandover(db, outbox, [order.accepted_by, order.responsible_id], [actor.id, responsible.id], {
    type: 'order_handover',
    title: `Заявку №${order.number} передали`,
    body: [
      `${handoverTitle}. От: ${actor.fullName}. Кому: ${responsible.full_name}.`,
      `Причина и что сделано: ${input.comment}`,
    ].join('\n'),
    link: `/orders/${orderId}`,
  });
  if (responsible.id !== actor.id) {
    const title = handoverTitle;
    outbox.add({
      userId: responsible.id,
      type: 'order_assigned',
      title: `Вам передали заявку №${order.number}`,
      body: [`${stage?.name}: ${title}. От: ${actor.fullName}.`, due && `Срок — ${formatDateTimeRu(due)}.`, input.comment]
        .filter(Boolean)
        .join('\n'),
      link: `/orders/${orderId}`,
    });
  }
  outbox.touch('orders', 'tasks', 'dashboard');
}

/**
 * Выданная техника вернулась (гарантия или новая поломка): та же заявка открывается заново на диагностике,
 * история остаётся, номер не меняется.
 */
export async function reopenOrder(db: Db, actor: Actor, orderId: number, input: ReopenOrderInput, outbox: Outbox) {
  const order = await lockOrder(db, orderId);
  if (!(can(actor.role, 'orders.advanceAny') || order.responsible_id === actor.id || order.accepted_by === actor.id)) {
    throw forbidden('Открыть заявку заново может приёмщик, ответственный или руководитель');
  }
  const stages = await activeStages(db);
  const current = stages.find((s) => s.id === order.stage_id);
  if (!current?.isFinal) throw new HttpError(409, 'Заявка ещё в работе, открывать заново не нужно');
  const entry = stages[1];
  if (!entry) throw new HttpError(500, 'В справочнике нет этапа для повторной диагностики');
  const responsible = await assertActiveUser(db, input.responsibleId);
  const due = await normalizeDue(db, input.dueAt);
  const label = input.reason === 'warranty' ? 'Возврат по гарантии' : 'Новая поломка';
  const note = [label, input.comment].filter(Boolean).join('. ');

  await db.query(
    `INSERT INTO order_history (order_id, kind, stage_id, responsible_id, from_user_id, due_at, comment)
     VALUES ($1, 'reopen', $2, $3, $4, $5, $6)`,
    [orderId, entry.id, responsible.id, actor.id, due, note],
  );
  await db.query(
    `UPDATE orders SET stage_id = $2, responsible_id = $3, stage_started_at = now(), stage_due_at = $4,
            issued_at = NULL, device_returned_at = NULL, outcome = NULL, reopen_count = reopen_count + 1, updated_at = now()
      WHERE id = $1`,
    [orderId, entry.id, responsible.id, due],
  );
  const title = await deviceTitle(db, order.device_id);
  await createTask(
    db,
    actor,
    {
      title: stageTaskTitle(entry, title, order.number),
      description: note,
      assigneeId: responsible.id,
      orderId,
      clientId: order.client_id,
      startAt: new Date().toISOString(),
      dueAt: due.toISOString(),
      deadlineAt: null,
      stageId: entry.id,
    },
    outbox,
  );
  await notifyHandover(db, outbox, [order.accepted_by], [actor.id, responsible.id], {
    type: 'order_reopened',
    title: `Заявка №${order.number} открыта заново`,
    body: `${title}. ${note}. Ответственный: ${responsible.full_name}.`,
    link: `/orders/${orderId}`,
  });
  outbox.touch('orders', 'tasks', 'dashboard', 'clients');
}
