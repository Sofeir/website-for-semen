import { HttpError } from '../lib/http';
import { many, one, type Db } from '../db/pool';

/** Таблицы, где запись принадлежит клиенту: всё это переезжает к клиенту-получателю целиком. */
const MOVE_TABLES = ['devices', 'intake_batches', 'orders', 'tasks', 'attachments', 'service_checklist_items', 'device_works', 'device_inspections', 'users'] as const;

export interface MergePlan {
  from: { id: number; name: string };
  to: { id: number; name: string };
  /** Сколько записей переедет: заявки, техника, работы и т.д. */
  moves: Record<(typeof MOVE_TABLES)[number], number>;
  contacts: number;
  /** Люди, которые уже есть у получателя (то же ФИО): их записи привязываются к уже существующим, второй раз не заводятся. */
  contactsSame: number;
  fleetRows: number;
  /** Строки парка по отделам, которые у получателя уже есть: остаются у старой организации. */
  fleetSame: number;
  /** move — график выездов переедет; skip — у получателя уже есть свой, остаётся у старой организации; none — у старой графика нет. */
  servicePlan: 'move' | 'skip' | 'none';
}

const count = async (db: Db, table: string, col: string, id: number) =>
  (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [id], db))!.n;

async function plan(db: Db, fromId: number, toId: number): Promise<MergePlan> {
  const from = await one<{ id: number; name: string }>('SELECT id, name FROM clients WHERE id = $1', [fromId], db);
  const to = await one<{ id: number; name: string }>('SELECT id, name FROM clients WHERE id = $1', [toId], db);
  if (!from || !to) throw new HttpError(404, 'Клиент не найден');
  if (from.id === to.id) throw new HttpError(400, 'Выберите другую организацию: перенести в ту же нельзя');
  const moves = {} as MergePlan['moves'];
  for (const t of MOVE_TABLES) moves[t] = await count(db, t, 'client_id', fromId);
  const contactsSame = (
    await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM client_contacts d
        WHERE d.client_id = $1 AND EXISTS (SELECT 1 FROM client_contacts t WHERE t.client_id = $2 AND lower(trim(t.full_name)) = lower(trim(d.full_name)))`,
      [fromId, toId],
      db,
    )
  )!.n;
  const fleetSame = (
    await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM fleet_rows d
        WHERE d.client_id = $1 AND EXISTS (SELECT 1 FROM fleet_rows t WHERE t.client_id = $2 AND lower(trim(t.department)) = lower(trim(d.department)))`,
      [fromId, toId],
      db,
    )
  )!.n;
  const hasPlan = (await count(db, 'service_plans', 'client_id', fromId)) > 0;
  const targetPlan = (await count(db, 'service_plans', 'client_id', toId)) > 0;
  const contacts = await count(db, 'client_contacts', 'client_id', fromId);
  const fleet = await count(db, 'fleet_rows', 'client_id', fromId);
  return {
    from,
    to,
    moves,
    contacts,
    contactsSame,
    fleetRows: fleet,
    fleetSame,
    servicePlan: !hasPlan ? 'none' : targetPlan ? 'skip' : 'move',
  };
}

/** Что переедет, без изменений. */
export const previewMerge = (db: Db, fromId: number, toId: number) => plan(db, fromId, toId);

/**
 * Переносит всё, что относится к клиенту «откуда» (заявки, технику, журнал работ, выезды и проверки, задачи, файлы, людей, парк техники,
 * график выездов, личные кабинеты), к клиенту «куда». Номера заявок, актов и квитанций не меняются. Старый клиент остаётся без данных:
 * удалить его решает человек. Если после переноса у старого осталось хоть что-то из переносимого, всё откатывается.
 */
export async function mergeClients(db: Db, fromId: number, toId: number): Promise<MergePlan> {
  const p = await plan(db, fromId, toId);

  // Люди с тем же ФИО у получателя уже есть: записи заявок и техники привязываем к ним, дубль не переносим
  const same = await many<{ donor_id: number; target_id: number }>(
    `SELECT d.id AS donor_id, (SELECT t.id FROM client_contacts t WHERE t.client_id = $2 AND lower(trim(t.full_name)) = lower(trim(d.full_name)) ORDER BY t.id LIMIT 1) AS target_id
       FROM client_contacts d WHERE d.client_id = $1`,
    [fromId, toId],
    db,
  );
  const dup = same.filter((r) => r.target_id);
  for (const r of dup) {
    await db.query('UPDATE orders SET contact_id = $2 WHERE contact_id = $1', [r.donor_id, r.target_id]);
    await db.query('UPDATE devices SET user_contact_id = $2 WHERE user_contact_id = $1', [r.donor_id, r.target_id]);
  }
  await db.query('UPDATE client_contacts SET client_id = $2 WHERE client_id = $1 AND NOT (id = ANY ($3))', [fromId, toId, dup.map((r) => r.donor_id)]);

  if (p.servicePlan === 'move') await db.query('UPDATE service_plans SET client_id = $2 WHERE client_id = $1', [fromId, toId]);
  await db.query(
    `UPDATE fleet_rows SET client_id = $2 WHERE client_id = $1
        AND lower(trim(department)) NOT IN (SELECT lower(trim(department)) FROM fleet_rows WHERE client_id = $2)`,
    [fromId, toId],
  );
  for (const t of MOVE_TABLES) await db.query(`UPDATE ${t} SET client_id = $2 WHERE client_id = $1`, [fromId, toId]);

  // Проверка: у старого клиента ничего из переносимого не осталось
  for (const t of MOVE_TABLES) {
    const left = await count(db, t, 'client_id', fromId);
    if (left) throw new HttpError(500, `Перенос остановлен: в «${t}» осталось ${left} записей. Ничего не изменено`);
  }
  await db.query(`UPDATE clients SET note = concat_ws(E'\\n', note, $2::text) WHERE id = $1`, [
    fromId,
    `Всё перенесено в «${p.to.name}» ${new Date().toLocaleDateString('ru-RU')}. Эту запись можно удалить.`,
  ]);
  return p;
}
