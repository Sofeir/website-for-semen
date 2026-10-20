import { Router } from 'express';
import { contactSchema, normalizePhone, type Contact, type ContactHit } from '@sd/shared';
import { many, one, pool, type Db } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';
import { likeEscape } from '../services/sql';
import { createClient } from '../services/clients';

export const contactsRouter = Router();

const CONTACT_SELECT = `
  SELECT c.id, c.client_id AS "clientId", c.full_name AS "fullName", c.phone, c.position, c.person_client_id AS "personClientId"
    FROM client_contacts c`;

/** Фильтр по ФИО или цифрам телефона. Добавляет параметры в `params`. */
function searchSql(q: string, params: unknown[]) {
  params.push(`%${likeEscape(q)}%`);
  const like = `$${params.length}`;
  let digits = q.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  const parts = [`c.full_name ILIKE ${like}`];
  if (digits.length >= 3) {
    params.push(`%${digits}%`);
    parts.push(`c.phone_digits LIKE $${params.length}`);
  }
  return `(${parts.join(' OR ')})`;
}

/** Сотрудники организации: подсказки при приёме. */
contactsRouter.get(
  '/clients/:id/contacts',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const q = String(req.query.q ?? '').trim();
    const params: unknown[] = [id];
    const where = ['c.client_id = $1'];
    if (q) where.push(searchSql(q, params));
    res.json(await many<Contact>(`${CONTACT_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.full_name LIMIT 50`, params));
  }),
);

/** Человек из любой организации: чтобы не заводить его второй раз как частного клиента. */
contactsRouter.get(
  '/contacts/search',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const params: unknown[] = [];
    const where = searchSql(q, params);
    res.json(
      await many<ContactHit>(
        `SELECT c.id, c.client_id AS "clientId", c.full_name AS "fullName", c.phone, c.position,
                c.person_client_id AS "personClientId", o.name AS "clientName"
           FROM client_contacts c JOIN clients o ON o.id = c.client_id
          WHERE ${where} ORDER BY c.full_name LIMIT 20`,
        params,
      ),
    );
  }),
);

/** Ищет у человека уже существующую карточку частного клиента по телефону. */
async function findPersonByPhone(db: Db, digits: string | null) {
  if (!digits) return null;
  return one<{ id: number }>(`SELECT id FROM clients WHERE kind = 'person' AND phone_digits = $1 LIMIT 1`, [digits], db);
}

contactsRouter.post(
  '/clients/:id/contacts',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const clientId = intParam(req.params.id);
    const input = parse(contactSchema, req.body);
    const c = await one<{ kind: string }>('SELECT kind FROM clients WHERE id = $1', [clientId]);
    if (!c) throw new HttpError(404, 'Клиент не найден');
    if (c.kind !== 'legal') throw new HttpError(400, 'Людей добавляем только в организации');
    const digits = normalizePhone(input.phone);
    const dup = await one<{ id: number; full_name: string }>(
      'SELECT id, full_name FROM client_contacts WHERE client_id = $1 AND phone_digits = $2 LIMIT 1',
      [clientId, digits],
    );
    if (dup) {
      throw new HttpError(409, `Этот телефон уже есть у сотрудника: ${dup.full_name}`, { code: 'contact_exists', contactId: dup.id });
    }
    const person = await findPersonByPhone(pool, digits);
    const row = await one<{ id: number }>(
      `INSERT INTO client_contacts (client_id, full_name, phone, phone_digits, position, person_client_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clientId, input.fullName, input.phone, digits, input.position, person?.id ?? null],
    );
    broadcast('changed', { scopes: ['clients'] });
    res.status(201).json({ id: row!.id });
  }),
);

contactsRouter.put(
  '/contacts/:id',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const input = parse(contactSchema, req.body);
    const cur = await one<{ client_id: number }>('SELECT client_id FROM client_contacts WHERE id = $1', [id]);
    if (!cur) throw new HttpError(404, 'Сотрудник не найден');
    const digits = normalizePhone(input.phone);
    const dup = await one('SELECT 1 FROM client_contacts WHERE client_id = $1 AND phone_digits = $2 AND id <> $3', [cur.client_id, digits, id]);
    if (dup) throw new HttpError(409, 'Этот телефон уже есть у другого сотрудника организации');
    await pool.query('UPDATE client_contacts SET full_name = $2, phone = $3, phone_digits = $4, position = $5 WHERE id = $1', [
      id,
      input.fullName,
      input.phone,
      digits,
      input.position,
    ]);
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.json({ ok: true });
  }),
);

contactsRouter.delete(
  '/contacts/:id',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const r = await pool.query('DELETE FROM client_contacts WHERE id = $1', [intParam(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Сотрудник не найден');
    broadcast('changed', { scopes: ['clients', 'orders'] });
    res.json({ ok: true });
  }),
);

/** Тот же человек как частный клиент: возвращаем существующую карточку или создаём из его ФИО и телефона. */
contactsRouter.post(
  '/contacts/:id/person',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const c = await one<{ full_name: string; phone: string | null; phone_digits: string | null; person_client_id: number | null }>(
      'SELECT full_name, phone, phone_digits, person_client_id FROM client_contacts WHERE id = $1',
      [id],
    );
    if (!c) throw new HttpError(404, 'Сотрудник не найден');
    let personId = c.person_client_id ?? (await findPersonByPhone(pool, c.phone_digits))?.id ?? null;
    if (!personId) {
      personId = await createClient(pool, req.user!.id, {
        kind: 'person',
        name: c.full_name,
        phone: c.phone,
        phone2: null,
        email: null,
        address: null,
        inn: null,
        kpp: null,
        contactPerson: null,
        note: 'Заведён из сотрудника организации',
      });
    }
    await pool.query('UPDATE client_contacts SET person_client_id = $2 WHERE id = $1', [id, personId]);
    broadcast('changed', { scopes: ['clients'] });
    res.json({ id: personId });
  }),
);

/** Частный клиент становится сотрудником организации без повторного ввода. */
contactsRouter.post(
  '/clients/:id/contacts/from-person',
  requirePermission('clients.edit'),
  h(async (req, res) => {
    const clientId = intParam(req.params.id);
    const personId = Number(req.body?.personClientId);
    if (!Number.isInteger(personId) || personId <= 0) throw new HttpError(400, 'Не выбран клиент');
    const org = await one<{ kind: string }>('SELECT kind FROM clients WHERE id = $1', [clientId]);
    if (!org || org.kind !== 'legal') throw new HttpError(400, 'Организация не найдена');
    const p = await one<{ name: string; phone: string | null; phone_digits: string | null }>(
      `SELECT name, phone, phone_digits FROM clients WHERE id = $1 AND kind = 'person'`,
      [personId],
    );
    if (!p) throw new HttpError(404, 'Частный клиент не найден');
    const exist = await one<{ id: number }>(
      `SELECT id FROM client_contacts
        WHERE client_id = $1 AND (person_client_id = $2 OR (phone_digits IS NOT NULL AND phone_digits = $3)) LIMIT 1`,
      [clientId, personId, p.phone_digits],
    );
    let contactId = exist?.id;
    if (!contactId) {
      const row = await one<{ id: number }>(
        `INSERT INTO client_contacts (client_id, full_name, phone, phone_digits, person_client_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [clientId, p.name, p.phone, p.phone_digits, personId],
      );
      contactId = row!.id;
    } else {
      await pool.query('UPDATE client_contacts SET person_client_id = $2 WHERE id = $1', [contactId, personId]);
    }
    broadcast('changed', { scopes: ['clients'] });
    res.json({ id: contactId });
  }),
);
