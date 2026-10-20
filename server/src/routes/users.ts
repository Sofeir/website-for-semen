import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { can, userCreateSchema, userUpdateSchema } from '@sd/shared';
import { many, one, pool } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';

export const usersRouter = Router();

/** Список сотрудников для выбора ответственного — нужен всем. Логины видит только админ. */
usersRouter.get(
  '/users',
  h(async (req, res) => {
    const admin = can(req.user!.role, 'users.manage');
    const rows = await many(
      `SELECT id, full_name AS "fullName", role, position, is_active AS "isActive"${admin ? ', login, phone, email, role_confirmed AS "roleConfirmed"' : ''}
         FROM users WHERE role <> 'customer'${admin ? '' : ' AND is_active'} ORDER BY is_active DESC, full_name`,
    );
    res.json(rows);
  }),
);

usersRouter.post(
  '/users',
  requirePermission('users.manage'),
  h(async (req, res) => {
    const u = parse(userCreateSchema, req.body);
    const exists = await one('SELECT 1 FROM users WHERE lower(login) = lower($1)', [u.login]);
    if (exists) throw new HttpError(409, 'Такой логин уже занят', { fields: { login: 'Такой логин уже занят' } });
    const row = await one(
      `INSERT INTO users (login, password_hash, full_name, role, phone, email, position) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [u.login, await bcrypt.hash(u.password, 10), u.fullName, u.role, u.phone, u.email, u.position],
    );
    res.status(201).json({ id: row.id });
  }),
);

usersRouter.put(
  '/users/:id',
  requirePermission('users.manage'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const u = parse(userUpdateSchema, req.body);
    if (id === req.user!.id && (u.isActive === false || (u.role && !can(u.role, 'users.manage')))) {
      throw new HttpError(400, 'Нельзя отключить себя или снять с себя полный доступ');
    }
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (u.fullName !== undefined) add('full_name', u.fullName);
    if (u.role !== undefined) add('role', u.role);
    // сменили роль вручную — значит, теперь она известна точно
    if (u.roleConfirmed !== undefined) add('role_confirmed', u.roleConfirmed);
    else if (u.role !== undefined) add('role_confirmed', true);
    if (u.phone !== undefined) add('phone', u.phone);
    if (u.position !== undefined) add('position', u.position);
    if (u.email !== undefined) add('email', u.email);
    if (u.isActive !== undefined) add('is_active', u.isActive);
    if (u.password) add('password_hash', await bcrypt.hash(u.password, 10));
    if (!sets.length) return res.json({ ok: true });
    const r = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND role <> 'customer'`, vals);
    if (!r.rowCount) throw new HttpError(404, 'Сотрудник не найден');
    if (u.isActive === false || u.password) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    res.json({ ok: true });
  }),
);
