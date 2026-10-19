import { Router } from 'express';
import { normalizePhone, type CustomerAccount } from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { h, HttpError, intParam } from '../lib/http';
import { requirePermission } from '../auth/session';
import { Outbox } from '../notify/notify';

/** Заказчики глазами руководителя: кто ждёт подтверждения, кому открыт доступ. */
export const customersRouter = Router();

customersRouter.get(
  '/customers',
  requirePermission('customers.manage'),
  h(async (_req, res) => {
    const rows = await many<CustomerAccount>(
      `SELECT u.id, u.login, u.full_name AS "fullName", u.phone, u.email, coalesce(u.reg_kind, c.kind, 'person') AS kind,
              u.pending, u.is_active AS "isActive", u.client_id AS "clientId", c.name AS "clientName", u.created_at AS "createdAt",
              (SELECT count(*)::int FROM tasks t WHERE t.creator_id = u.id) AS "tasksCount"
         FROM users u LEFT JOIN clients c ON c.id = u.client_id
        WHERE u.role = 'customer'
        ORDER BY u.pending DESC, u.is_active DESC, u.created_at DESC`,
    );
    res.json(rows);
  }),
);

/**
 * Подтверждение регистрации. Кабинет привязывается к карточке клиента: находим по телефону
 * уже существующую или заводим новую. Можно указать свою карточку: { clientId }.
 */
customersRouter.post(
  '/customers/:id/approve',
  requirePermission('customers.manage'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const chosen = Number(req.body?.clientId) || null;
    const clientId = await tx(async (db) => {
      const u = await one<{
        full_name: string;
        phone: string | null;
        email: string | null;
        reg_kind: 'person' | 'legal' | null;
        reg_contact: string | null;
        pending: boolean;
      }>(
        `SELECT full_name, phone, email, reg_kind, reg_contact, pending FROM users WHERE id = $1 AND role = 'customer' FOR UPDATE`,
        [id],
        db,
      );
      if (!u) throw new HttpError(404, 'Заказчик не найден');
      if (!u.pending) throw new HttpError(409, 'Регистрация уже подтверждена');
      let cid = chosen;
      if (cid) {
        const ok = await one('SELECT 1 FROM clients WHERE id = $1', [cid], db);
        if (!ok) throw new HttpError(400, 'Такого клиента нет');
      } else {
        const digits = normalizePhone(u.phone);
        const found = digits
          ? await one<{ id: number }>('SELECT id FROM clients WHERE phone_digits = $1 ORDER BY id LIMIT 1', [digits], db)
          : null;
        if (found) cid = found.id;
        else {
          const created = await one<{ id: number }>(
            `INSERT INTO clients (kind, name, phone, phone_digits, email, contact_person, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [u.reg_kind ?? 'person', u.full_name, u.phone, digits || null, u.email, u.reg_contact, req.user!.id],
            db,
          );
          cid = created!.id;
        }
      }
      await db.query('UPDATE users SET pending = false, client_id = $2 WHERE id = $1', [id, cid]);
      return cid;
    });
    const outbox = new Outbox();
    outbox.touch('customers', 'clients');
    await outbox.flush();
    res.json({ ok: true, clientId });
  }),
);

/** Отказ: регистрация удаляется, логин освобождается. */
customersRouter.post(
  '/customers/:id/reject',
  requirePermission('customers.manage'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const r = await pool.query(`DELETE FROM users WHERE id = $1 AND role = 'customer' AND pending`, [id]);
    if (!r.rowCount) throw new HttpError(404, 'Заявка не найдена или уже обработана');
    res.json({ ok: true });
  }),
);

customersRouter.put(
  '/customers/:id',
  requirePermission('customers.manage'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    if (typeof req.body?.isActive !== 'boolean') throw new HttpError(400, 'Не указан доступ');
    const r = await pool.query(`UPDATE users SET is_active = $2 WHERE id = $1 AND role = 'customer' AND NOT pending`, [
      id,
      req.body.isActive,
    ]);
    if (!r.rowCount) throw new HttpError(404, 'Заказчик не найден');
    if (!req.body.isActive) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    res.json({ ok: true });
  }),
);
