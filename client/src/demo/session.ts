// Сессия для демо: вместо cookie и хешей — id пользователя в хранилище браузера.
import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role } from '@sd/shared';
import { one } from '../../../server/src/db/pool';
import { forbidden, HttpError } from '../../../server/src/lib/http';
import type { Actor } from '../../../server/src/services/tasks';

export const SESSION_COOKIE = 'sd_session';
const KEY = 'asoft-demo-user';

export interface SessionUser extends Actor {
  login: string;
  clientId: number | null;
  sessionId: string;
  csrfToken: string;
}

const read = () => {
  try {
    return Number(sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
};

export async function createSession(_res: Response, userId: number, remember: boolean) {
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, String(userId));
  } catch {
    /* хранилище закрыто: войти получится, но после перезагрузки сессия пропадёт */
  }
  return 'demo-csrf';
}

export async function destroySession() {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    /* ничего */
  }
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const id = read();
    if (id) {
      const u = await one<{ id: number; login: string; full_name: string; role: Role; client_id: number | null }>(
        'SELECT id, login, full_name, role, client_id FROM users WHERE id = $1 AND is_active',
        [id],
      );
      if (u)
        req.user = {
          id: u.id,
          login: u.login,
          fullName: u.full_name,
          role: u.role,
          clientId: u.client_id,
          sessionId: 'demo',
          csrfToken: 'demo-csrf',
        };
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Войдите в систему'));
  next();
}

/** Всё, что не про заказчика, ему закрыто. */
const CUSTOMER_OPEN = ['/notifications', '/events'];

export function denyCustomer(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'customer') return next();
  // полный адрес без «?query» и без префикса /api: так одинаково и на сервере, и в демо-версии
  const path = String(req.originalUrl ?? req.url ?? req.path ?? '')
    .split('?')[0]
    .replace(/^\/api(?=\/)/, '');
  if (CUSTOMER_OPEN.some((p) => path === p || path.startsWith(`${p}/`))) return next();
  next(forbidden());
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Войдите в систему'));
  if (req.user.role !== 'customer') return next(forbidden());
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Войдите в систему'));
    if (!can(req.user.role, permission)) return next(forbidden());
    next();
  };
}

export function csrfProtection(_req: Request, _res: Response, next: NextFunction) {
  next();
}
