import { can } from '@sd/shared';
import { one, pool, type Db } from '../db/pool';
import { HttpError } from '../lib/http';
import { orderAccess, taskAccess } from './sql';
import type { Actor } from './tasks';

const denied = () => new HttpError(403, 'Это ведёт другой сотрудник. Если доступ нужен, попросите руководителя.');

/** Бросает 403, если сотрудник не должен видеть эту заявку. Руководитель и администратор видят все. */
export async function assertOrderVisible(actor: Actor, orderId: number, db: Db = pool) {
  if (can(actor.role, 'orders.viewAll')) return;
  const ok = await one(`SELECT 1 FROM orders o WHERE o.id = $1 AND ${orderAccess('o', '$2')}`, [orderId, actor.id], db);
  if (!ok) throw denied();
}

export async function assertTaskVisible(actor: Actor, taskId: number, db: Db = pool) {
  if (can(actor.role, 'tasks.manageAll')) return;
  const ok = await one(`SELECT 1 FROM tasks t WHERE t.id = $1 AND ${taskAccess('t', '$2')}`, [taskId, actor.id], db);
  if (!ok) throw denied();
}
