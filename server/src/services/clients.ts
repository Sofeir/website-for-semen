import { normalizePhone, type ClientInput, type FleetRow } from '@sd/shared';
import { one, type Db } from '../db/pool';
import { HttpError } from '../lib/http';

/** Ищет дубль: физлицо по телефону, юрлицо по ИНН. */
export async function findDuplicateClient(db: Db, input: ClientInput, excludeId?: number) {
  if (input.kind === 'person' && input.phone) {
    const digits = normalizePhone(input.phone);
    return one<{ id: number; name: string }>(
      `SELECT id, name FROM clients WHERE phone_digits = $1 AND kind = 'person' AND id <> $2 LIMIT 1`,
      [digits, excludeId ?? 0],
      db,
    );
  }
  if (input.kind === 'legal' && input.inn) {
    return one<{ id: number; name: string }>(
      `SELECT id, name FROM clients WHERE inn = $1 AND id <> $2 LIMIT 1`,
      [input.inn, excludeId ?? 0],
      db,
    );
  }
  return undefined;
}

export async function createClient(db: Db, actorId: number, input: ClientInput): Promise<number> {
  const dup = await findDuplicateClient(db, input);
  if (dup) {
    throw new HttpError(409, `Клиент уже есть в базе: ${dup.name}`, { code: 'client_exists', clientId: dup.id });
  }
  const row = await one<{ id: number }>(
    `INSERT INTO clients (kind, name, phone, phone_digits, phone2, email, address, inn, kpp, contact_person, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      input.kind,
      input.name,
      input.phone || null,
      input.phone ? normalizePhone(input.phone) : null,
      input.phone2 || null,
      input.email || null,
      input.address,
      input.inn,
      input.kpp,
      input.contactPerson,
      input.note,
      actorId,
    ],
    db,
  );
  return row!.id;
}

export async function updateClient(db: Db, id: number, input: ClientInput) {
  const dup = await findDuplicateClient(db, input, id);
  if (dup) {
    throw new HttpError(409, `Такой клиент уже есть: ${dup.name}`, { code: 'client_exists', clientId: dup.id });
  }
  const r = await db.query(
    `UPDATE clients SET kind = $2, name = $3, phone = $4, phone_digits = $5, phone2 = $6, email = $7, address = $8,
            inn = $9, kpp = $10, contact_person = $11, note = $12, updated_at = now()
      WHERE id = $1`,
    [
      id,
      input.kind,
      input.name,
      input.phone || null,
      input.phone ? normalizePhone(input.phone) : null,
      input.phone2 || null,
      input.email || null,
      input.address,
      input.inn,
      input.kpp,
      input.contactPerson,
      input.note,
    ],
  );
  if (!r.rowCount) throw new HttpError(404, 'Клиент не найден');
}

export async function replaceFleet(db: Db, clientId: number, rows: FleetRow[]) {
  await db.query('DELETE FROM fleet_rows WHERE client_id = $1', [clientId]);
  let sort = 0;
  for (const r of rows) {
    await db.query(
      `INSERT INTO fleet_rows (client_id, department, pc_count, mfu_count, reserve, ssd_check, note, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [clientId, r.department, r.pcCount, r.mfuCount, r.reserve, r.ssdCheck, r.note, sort++],
    );
  }
}
