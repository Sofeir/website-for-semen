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
      const u = await one<{ id: number; login: string; full_name: string; role: Role }>(
        'SELECT id, login, full_name, role FROM users WHERE id = $1 AND is_active',
        [id],
      );
      if (u) req.user = { id: u.id, login: u.login, fullName: u.full_name, role: u.role, sessionId: 'demo', csrfToken: 'demo-csrf' };
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
