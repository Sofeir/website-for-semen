import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { many, tx } from '../db/pool';

/** Заявка в списке для проверки перед удалением. */
export interface OrderBrief {
  id: number;
  number: string;
  createdAt: Date;
  client: string;
  device: string;
  stage: string;
}

export async function listOrders(): Promise<OrderBrief[]> {
  return many<OrderBrief>(
    `SELECT o.id, o.number, o.created_at AS "createdAt", c.name AS client, dt.name || COALESCE(' ' || d.brand_text, '') || COALESCE(' ' || d.model_text, '') AS device, s.name AS stage
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       JOIN devices d ON d.id = o.device_id
       JOIN device_types dt ON dt.id = d.device_type_id
       JOIN stages s ON s.id = o.stage_id
      ORDER BY o.number`,
  );
}

/** Клиент без заявок и задач после чистки. Удаляется только по явному списку номеров. */
export interface LeftoverClient {
  id: number;
  name: string;
  devices: number;
  works: number;
  tasks: number;
  hasAccount: boolean;
}

export async function clientsWithoutOrders(): Promise<LeftoverClient[]> {
  return many<LeftoverClient>(
    `SELECT c.id, c.name,
            (SELECT count(*)::int FROM devices d WHERE d.client_id = c.id) AS devices,
            (SELECT count(*)::int FROM device_works w WHERE w.client_id = c.id) AS works,
            (SELECT count(*)::int FROM tasks t WHERE t.client_id = c.id) AS tasks,
            EXISTS (SELECT 1 FROM users u WHERE u.client_id = c.id) AS "hasAccount"
       FROM clients c
      WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id = c.id)
      ORDER BY c.id`,
  );
}

/** Сколько задач выбранных заявок уйдёт вместе с ними и сколько останется (созданные с keepFrom). */
export async function orderTasksSplit(orderIds: number[], keepFrom: Date | null): Promise<{ remove: number; keep: number }> {
  const rows = await many<{ created_at: Date }>('SELECT created_at FROM tasks WHERE order_id = ANY ($1)', [orderIds]);
  const keep = keepFrom ? rows.filter((r) => r.created_at >= keepFrom).length : 0;
  return { remove: rows.length - keep, keep };
}

/**
 * Удаляет заявки по списку вместе со всем, что от них зависит: история этапов, акты, задачи (с файлами, шагами цепочки,
 * уведомлениями и напоминаниями), записи работ и заправок по этим заявкам. Файлы заявок стираются с диска.
 * Техника, у которой после этого нет ни заявок, ни записей работ, тоже удаляется. Клиенты не трогаются.
 */
export async function deleteOrders(
  orderIds: number[],
  opts: { keepTasksFrom?: Date | null } = {},
  db?: PoolClient,
): Promise<{ orders: number; tasks: number; keptTasks: number; works: number; devices: number }> {
  if (!orderIds.length) return { orders: 0, tasks: 0, keptTasks: 0, works: 0, devices: 0 };
  const keepFrom = opts.keepTasksFrom ?? null;
  const run = async (c: PoolClient) => {
    // Задачи, созданные с указанного момента, остаются: их только отвязывают от заявки, чтобы они не ушли вместе с ней
    const kept = keepFrom
      ? await c.query('UPDATE tasks SET order_id = NULL, stage_id = NULL WHERE order_id = ANY ($1) AND created_at >= $2', [orderIds, keepFrom])
      : { rowCount: 0 };
    const taskIds = (await c.query<{ id: number }>('SELECT id FROM tasks WHERE order_id = ANY ($1)', [orderIds])).rows.map((r) => r.id);
    const deviceIds = (await c.query<{ device_id: number }>('SELECT DISTINCT device_id FROM orders WHERE id = ANY ($1)', [orderIds])).rows.map(
      (r) => r.device_id,
    );
    const stored = (
      await c.query<{ stored_name: string }>('SELECT stored_name FROM attachments WHERE order_id = ANY ($1) OR task_id = ANY ($2)', [orderIds, taskIds])
    ).rows.map((r) => r.stored_name);
    await c.query('DELETE FROM attachments WHERE order_id = ANY ($1) OR task_id = ANY ($2)', [orderIds, taskIds]);
    await c.query('DELETE FROM notifications WHERE link = ANY ($1)', [
      [...orderIds.map((id) => `/orders/${id}`), ...taskIds.map((id) => `/tasks?task=${id}`)],
    ]);
    await c.query(`DELETE FROM reminders_sent WHERE kind = 'task' AND ref_id = ANY ($1)`, [taskIds]);
    const works = await c.query('DELETE FROM device_works WHERE order_id = ANY ($1)', [orderIds]);
    await c.query('DELETE FROM orders WHERE id = ANY ($1)', [orderIds]);
    const devices = await c.query(
      `DELETE FROM devices d
        WHERE d.id = ANY ($1)
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.device_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM device_works w WHERE w.device_id = d.id)`,
      [deviceIds],
    );
    for (const f of stored) fs.rmSync(path.join(config.uploadDir, path.basename(f)), { force: true });
    return { orders: orderIds.length, tasks: taskIds.length, keptTasks: kept.rowCount ?? 0, works: works.rowCount ?? 0, devices: devices.rowCount ?? 0 };
  };
  return db ? run(db) : tx(run);
}

/** Удаляет клиентов по явному списку. Клиентов с заявками и с учётной записью заказчика не трогает. */
export async function deleteClients(clientIds: number[]): Promise<number> {
  if (!clientIds.length) return 0;
  return tx(async (c) => {
    const res = await c.query(
      `DELETE FROM clients cl
        WHERE cl.id = ANY ($1)
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id = cl.id)
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.client_id = cl.id)`,
      [clientIds],
    );
    return res.rowCount ?? 0;
  });
}
