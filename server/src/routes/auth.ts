import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { changePasswordSchema, loginSchema, profileSchema, type Me } from '@sd/shared';
import { one, pool } from '../db/pool';
import { h, HttpError, parse } from '../lib/http';
import { createSession, destroySession, requireAuth } from '../auth/session';
import { loginRetryAfter, registerLoginFail, resetLoginFails } from '../auth/rateLimit';
import { channels } from '../notify/channels';
import { config } from '../config';

export const authRouter = Router();

// Хеш-пустышка: сравниваем даже при неизвестном логине, чтобы время ответа не выдавало, есть ли такой пользователь.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

async function loadMe(userId: number): Promise<Me> {
  const u = await one(
    `SELECT id, login, full_name AS "fullName", role, phone, onboarded_at IS NOT NULL AS onboarded,
            notify_inapp AS "notifyInApp", notify_telegram AS "notifyTelegram", notify_max AS "notifyMax",
            telegram_chat_id AS "telegramChatId", max_user_id AS "maxUserId"
       FROM users WHERE id = $1`,
    [userId],
  );
  return {
    ...u,
    channels: {
      telegram: channels.find((c) => c.id === 'telegram')!.isEnabled(),
      max: channels.find((c) => c.id === 'max')!.isEnabled(),
    },
  };
}

authRouter.post(
  '/login',
  h(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const ip = req.ip || 'unknown';
    const wait = loginRetryAfter(ip, input.login);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, `Слишком много попыток. Попробуйте через ${Math.ceil(wait / 60)} мин.`);
    }
    const user = await one<{ id: number; password_hash: string; is_active: boolean }>(
      'SELECT id, password_hash, is_active FROM users WHERE lower(login) = lower($1)',
      [input.login],
    );
    const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) {
      registerLoginFail(ip, input.login);
      throw new HttpError(401, 'Неверный логин или пароль');
    }
    resetLoginFails(ip, input.login);
    const csrfToken = await createSession(res, user.id, input.remember, req.get('user-agent'));
    res.json({ user: await loadMe(user.id), csrfToken, appName: config.appName });
  }),
);

authRouter.post(
  '/logout',
  h(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  h(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите в систему', appName: config.appName });
    res.json({ user: await loadMe(req.user.id), csrfToken: req.user.csrfToken, appName: config.appName });
  }),
);

authRouter.put(
  '/me/profile',
  requireAuth,
  h(async (req, res) => {
    const p = parse(profileSchema, req.body);
    await pool.query(
      `UPDATE users SET notify_inapp = $2, notify_telegram = $3, notify_max = $4, telegram_chat_id = $5, max_user_id = $6
        WHERE id = $1`,
      [req.user!.id, p.notifyInApp, p.notifyTelegram, p.notifyMax, p.telegramChatId, p.maxUserId],
    );
    res.json(await loadMe(req.user!.id));
  }),
);

authRouter.post(
  '/me/password',
  requireAuth,
  h(async (req, res) => {
    const p = parse(changePasswordSchema, req.body);
    const u = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!u || !(await bcrypt.compare(p.current, u.password_hash))) {
      throw new HttpError(400, 'Текущий пароль не подходит', { fields: { current: 'Текущий пароль не подходит' } });
    }
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await bcrypt.hash(p.next, 10)]);
    // Остальные сессии пользователя закрываем.
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user!.id, req.user!.sessionId]);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/me/onboarded',
  requireAuth,
  h(async (req, res) => {
    const reset = req.body?.reset === true;
    await pool.query(`UPDATE users SET onboarded_at = ${reset ? 'NULL' : 'now()'} WHERE id = $1`, [req.user!.id]);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/me/test-channel/:channel',
  requireAuth,
  h(async (req, res) => {
    const ch = channels.find((c) => c.id === req.params.channel);
    if (!ch) throw new HttpError(404, 'Нет такого канала');
    if (!ch.isEnabled()) throw new HttpError(400, `${ch.label} не настроен на сервере: нет токена бота`);
    const me = await loadMe(req.user!.id);
    const target = ch.id === 'telegram' ? me.telegramChatId : me.maxUserId;
    if (!target) throw new HttpError(400, 'Сначала укажите и сохраните свой ID');
    try {
      await ch.send(target, { title: 'Проверка связи', body: `Уведомления ${config.appName} будут приходить сюда.` });
    } catch (e) {
      throw new HttpError(502, `${ch.label} не принял сообщение: ${(e as Error).message}`);
    }
    res.json({ ok: true });
  }),
);
