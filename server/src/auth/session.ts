import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role } from '@sd/shared';
import { config } from '../config';
import { one, pool } from '../db/pool';
import { forbidden, HttpError } from '../lib/http';
import type { Actor } from '../services/tasks';

export const SESSION_COOKIE = 'sd_session';

export interface SessionUser extends Actor {
  login: string;
  /** Для заказчика — его карточка клиента. */
  clientId: number | null;
  sessionId: string;
  csrfToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

export async function createSession(res: Response, userId: number, remember: boolean, userAgent?: string) {
  const token = randomToken();
  const csrf = randomToken();
  const ttlMs = remember ? config.rememberDays * 86400_000 : config.sessionHours * 3600_000;
  const expires = new Date(Date.now() + ttlMs);
  await pool.query(
    `INSERT INTO sessions (id, user_id, csrf_token, remember, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6)`,
    [sha256(token), userId, csrf, remember, expires, userAgent?.slice(0, 300) ?? null],
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    // Без «запомнить меня» — cookie живёт до закрытия браузера.
    ...(remember ? { expires } : {}),
  });
  return csrf;
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Подтягивает пользователя по cookie. Не требует входа — для этого `requireAuth`. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const id = sha256(token);
    const row = await one<{
      user_id: number;
      csrf_token: string;
      remember: boolean;
      login: string;
      full_name: string;
      role: Role;
      client_id: number | null;
      last_seen_at: Date;
    }>(
      `SELECT s.user_id, s.csrf_token, s.remember, s.last_seen_at, u.login, u.full_name, u.role, u.client_id
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now() AND u.is_active`,
      [id],
    );
    if (row) {
      req.user = {
        id: row.user_id,
        login: row.login,
        fullName: row.full_name,
        role: row.role,
        clientId: row.client_id,
        sessionId: id,
        csrfToken: row.csrf_token,
      };
      // Скользящий срок для обычной сессии, обновляем не чаще раза в 5 минут.
      if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
        const extend = row.remember ? null : new Date(Date.now() + config.sessionHours * 3600_000);
        pool
          .query(`UPDATE sessions SET last_seen_at = now(), expires_at = coalesce($2, expires_at) WHERE id = $1`, [id, extend])
          .catch(() => {});
      }
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

/** Всё, что не про заказчика, ему закрыто: сотрудники, клиенты, заявки, акты, файлы, настройки. */
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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF: для изменяющих запросов проверяем Origin (если браузер его прислал)
 * и токен из заголовка X-CSRF-Token, привязанный к сессии.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !config.allowedOrigins.includes(origin) && !isSameHost(origin, req)) {
    return next(new HttpError(403, 'Запрос с чужого адреса отклонён'));
  }
  if (!req.user) return next(); // вход/выход без сессии — дальше решит requireAuth
  const header = req.get('x-csrf-token');
  if (!header || !timingSafeEqual(header, req.user.csrfToken)) {
    return next(new HttpError(403, 'Сессия устарела. Обновите страницу.', { code: 'csrf' }));
  }
  next();
}

function isSameHost(origin: string, req: Request) {
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function timingSafeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
