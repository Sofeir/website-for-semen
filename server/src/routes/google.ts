import { Router } from 'express';
import type { GoogleCalendarStatus } from '@sd/shared';
import { one, pool } from '../db/pool';
import { h, HttpError } from '../lib/http';
import { clearGoogleUser, GoogleError, googleCheckCalendar, googleConfigured, googleServiceEmail, syncGoogleUser } from '../services/googleCalendar';

/** Свой Google Календарь сотрудника: ID календаря и состояние записи. Ключ сервисного аккаунта наружу не отдаётся. */
export const googleRouter = Router();

async function status(userId: number): Promise<GoogleCalendarStatus> {
  const u = await one<{ calendar_id: string | null; at: Date | null; error: string | null }>(
    'SELECT google_calendar_id AS calendar_id, google_sync_at AS at, google_sync_error AS error FROM users WHERE id = $1',
    [userId],
  );
  return {
    configured: await googleConfigured(),
    serviceEmail: await googleServiceEmail(),
    calendarId: u?.calendar_id ?? null,
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

googleRouter.put(
  '/me/google-calendar',
  h(async (req, res) => {
    if (!(await googleConfigured())) throw new HttpError(409, 'Сервер пока не подключён к Google: администратору нужно добавить ключ сервисного аккаунта');
    const calendarId = typeof req.body?.calendarId === 'string' ? req.body.calendarId.trim() : '';
    if (calendarId.length < 5 || calendarId.length > 200 || /\s/.test(calendarId)) throw new HttpError(400, 'Введите ID календаря: он выглядит как адрес почты');
    try {
      await googleCheckCalendar(calendarId);
    } catch (e) {
      if (e instanceof GoogleError && [403, 404].includes(e.status)) {
        const email = await googleServiceEmail();
        throw new HttpError(400, `Нет доступа к календарю. Поделитесь им с адресом ${email} и дайте право «Вносить изменения в мероприятия»`);
      }
      throw new HttpError(502, `Google не ответил: ${(e as Error).message}`);
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
    const u = await one<{ calendar_id: string | null }>('SELECT google_calendar_id AS calendar_id FROM users WHERE id = $1', [req.user!.id]);
    await clearGoogleUser(req.user!.id, u?.calendar_id ?? null);
    await pool.query('UPDATE users SET google_calendar_id = NULL, google_sync_at = NULL, google_sync_error = NULL WHERE id = $1', [req.user!.id]);
    res.json(await status(req.user!.id));
  }),
);
