import { Router } from 'express';
import type { GoogleCalendarStatus } from '@sd/shared';
import { config } from '../config';
import { one, pool } from '../db/pool';
import { h, HttpError } from '../lib/http';
import {
  clearGoogleUser,
  exchangeGoogleCode,
  GoogleError,
  googleAuthUrl,
  googleCalendarDescription,
  googleCheckCalendar,
  googleConfigured,
  googleOauthConfigured,
  googleServiceEmail,
  sealSecret,
  syncGoogleUser,
} from '../services/googleCalendar';

/** Случайная строка для одноразовой метки подключения. Web Crypto: работает и в демо в браузере. */
const randomToken = (bytes = 24) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Код подтверждения у сотрудника один и тот же, пока он его не сменит: создаётся при первом обращении. */
async function verifyCodeOf(userId: number): Promise<string> {
  const u = await one<{ code: string | null }>('SELECT google_verify_code AS code FROM users WHERE id = $1', [userId]);
  if (u?.code) return u.code;
  // Web Crypto: код работает и в демо в браузере
  const code = `SD-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('').toUpperCase()}`;
  await pool.query('UPDATE users SET google_verify_code = $2 WHERE id = $1 AND google_verify_code IS NULL', [userId, code]);
  return (await one<{ code: string }>('SELECT google_verify_code AS code FROM users WHERE id = $1', [userId]))!.code;
}

/** Свой Google Календарь сотрудника: подключение и состояние записи. Ключи приложения и токены наружу не отдаются. */
export const googleRouter = Router();

/**
 * Возврат из Google после того, как сотрудник разрешил доступ. Открывается переходом из браузера, без входа в сервис:
 * сотрудника находим по одноразовой метке (state), которую выдали при нажатии «Подключить».
 */
export const googleCallbackRouter = Router();

googleCallbackRouter.get(
  '/google/callback',
  h(async (req, res) => {
    const back = (result: string) => res.redirect(`${config.publicUrl.replace(/\/$/, '')}/profile?google=${result}`);
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    if (req.query.error || !code || !/^[a-f0-9]{20,100}$/.test(state)) return back('cancelled');
    const user = await one<{ id: number }>(
      `SELECT id FROM users WHERE google_oauth_state = $1 AND google_oauth_state_at > now() - interval '15 minutes' AND is_active`,
      [state],
    );
    if (!user) return back('expired');
    // метка одноразовая
    await pool.query('UPDATE users SET google_oauth_state = NULL, google_oauth_state_at = NULL WHERE id = $1', [user.id]);
    try {
      const { refreshToken, email } = await exchangeGoogleCode(code);
      await pool.query(
        `UPDATE users SET google_refresh_token = $2, google_email = $3, google_sync_error = NULL, google_calendar_id = NULL WHERE id = $1`,
        [user.id, await sealSecret(refreshToken), email],
      );
      await pool.query('DELETE FROM google_events WHERE user_id = $1', [user.id]);
      await syncGoogleUser(user.id);
      return back('connected');
    } catch (e) {
      console.error('Google Календарь: подключение не удалось:', (e as Error).message);
      return back('error');
    }
  }),
);

async function status(userId: number): Promise<GoogleCalendarStatus> {
  const u = await one<{ calendar_id: string | null; at: Date | null; error: string | null; token: string | null; email: string | null }>(
    `SELECT google_calendar_id AS calendar_id, google_sync_at AS at, google_sync_error AS error,
            google_refresh_token AS token, google_email AS email FROM users WHERE id = $1`,
    [userId],
  );
  return {
    configured: await googleConfigured(),
    oauthConfigured: googleOauthConfigured(),
    oauthConnected: Boolean(u?.token),
    connectedEmail: u?.token ? (u.email ?? null) : null,
    serviceEmail: await googleServiceEmail(),
    calendarId: u?.calendar_id ?? null,
    verifyCode: await verifyCodeOf(userId),
    syncedAt: u?.at ? u.at.toISOString() : null,
    error: u?.error ?? null,
  };
}

googleRouter.get(
  '/me/google-calendar',
  h(async (req, res) => {
    res.json(await status(req.user!.id));
  }),
);

/** Адрес Google, куда сотрудник идёт разрешить доступ к своему календарю. */
googleRouter.post(
  '/me/google-calendar/connect',
  h(async (req, res) => {
    if (!googleOauthConfigured()) throw new HttpError(409, 'Вход через Google пока не включён: администратору нужно добавить ключи приложения Google');
    const state = randomToken();
    await pool.query('UPDATE users SET google_oauth_state = $2, google_oauth_state_at = now() WHERE id = $1', [req.user!.id, state]);
    res.json({ url: googleAuthUrl(state) });
  }),
);

googleRouter.put(
  '/me/google-calendar',
  h(async (req, res) => {
    if (!(await googleServiceEmail())) throw new HttpError(409, 'Сервер пока не подключён к Google: администратору нужно добавить ключ сервисного аккаунта');
    const calendarId = typeof req.body?.calendarId === 'string' ? req.body.calendarId.trim() : '';
    if (calendarId.length < 5 || calendarId.length > 200 || /\s/.test(calendarId)) throw new HttpError(400, 'Введите ID календаря: он выглядит как адрес почты');
    // Календарь подключает один сотрудник: чужой, уже занятый коллегой, не принять
    const taken = await one('SELECT 1 FROM users WHERE lower(google_calendar_id) = lower($1) AND id <> $2', [calendarId, req.user!.id]);
    if (taken) throw new HttpError(409, 'Этот календарь уже подключён другим сотрудником');
    try {
      await googleCheckCalendar(calendarId);
    } catch (e) {
      if (e instanceof GoogleError && [403, 404].includes(e.status)) {
        const email = await googleServiceEmail();
        throw new HttpError(400, `Нет доступа к календарю. Поделитесь им с адресом ${email} и дайте право «Вносить изменения в мероприятия»`);
      }
      throw new HttpError(502, `Google не ответил: ${(e as Error).message}`);
    }
    // Календарь должен быть вашим: в его описании должен стоять код из профиля. Описание меняет только владелец календаря.
    const code = await verifyCodeOf(req.user!.id);
    if (!(await googleCalendarDescription(calendarId)).includes(code)) {
      throw new HttpError(400, `В описании календаря не нашли код ${code}. Вставьте его в поле «Описание» в настройках календаря и подключите снова`);
    }
    await pool.query('UPDATE users SET google_calendar_id = $2, google_sync_error = NULL WHERE id = $1', [req.user!.id, calendarId]);
    await syncGoogleUser(req.user!.id);
    res.json(await status(req.user!.id));
  }),
);

/** Синхронизировать сейчас, не дожидаясь очередной проверки. */
googleRouter.post(
  '/me/google-calendar/sync',
  h(async (req, res) => {
    await syncGoogleUser(req.user!.id);
    res.json(await status(req.user!.id));
  }),
);

googleRouter.delete(
  '/me/google-calendar',
  h(async (req, res) => {
    await clearGoogleUser(req.user!.id);
    await pool.query(
      'UPDATE users SET google_calendar_id = NULL, google_refresh_token = NULL, google_email = NULL, google_sync_at = NULL, google_sync_error = NULL WHERE id = $1',
      [req.user!.id],
    );
    res.json(await status(req.user!.id));
  }),
);
