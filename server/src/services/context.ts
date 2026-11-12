import { formatPhone } from '@sd/shared';
import { one, type Db } from '../db/pool';
import { DEVICE_TITLE } from './sql';

/**
 * Чья это техника и где она: строки для уведомлений и истории, чтобы не открывать заявку ради этого.
 * Номер техники (ПК-054), организация и филиал, где стоит, пользователь, этап.
 */
export async function orderContext(db: Db, orderId: number): Promise<string[]> {
  const r = await one<{
    number: string;
    stage: string;
    inventory_no: string | null;
    device: string;
    client: string;
    branch: string | null;
    department: string | null;
    location: string | null;
    user_name: string | null;
    user_phone: string | null;
  }>(
    `SELECT o.number, s.name AS stage, d.inventory_no, ${DEVICE_TITLE} AS device, c.name AS client, o.branch, o.department, d.location,
            duc.full_name AS user_name, duc.phone AS user_phone
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       JOIN devices d ON d.id = o.device_id
       JOIN device_types dt ON dt.id = d.device_type_id
       LEFT JOIN brands b ON b.id = d.brand_id
       LEFT JOIN models m ON m.id = d.model_id
       JOIN stages s ON s.id = o.stage_id
       LEFT JOIN client_contacts duc ON duc.id = d.user_contact_id
      WHERE o.id = $1`,
    [orderId],
    db,
  );
  if (!r) return [];
  return [
    `Техника: ${[r.inventory_no, r.device].filter(Boolean).join(', ')} (заявка №${r.number}).`,
    `Организация: ${[r.client, r.branch, r.department].filter(Boolean).join(', ')}.`,
    r.location && `Где стоит: ${r.location}.`,
    r.user_name && `Пользователь: ${r.user_name}${r.user_phone ? `, ${formatPhone(r.user_phone)}` : ''}.`,
    `Этап: ${r.stage}.`,
  ].filter((x): x is string => Boolean(x));
}

/** То же для задачи: если она по заявке, строки заявки; иначе пусто. */
export async function taskContext(db: Db, taskId: number): Promise<string[]> {
  const t = await one<{ order_id: number | null }>('SELECT order_id FROM tasks WHERE id = $1', [taskId], db);
  return t?.order_id ? orderContext(db, t.order_id) : [];
}
