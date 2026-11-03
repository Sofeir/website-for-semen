import { Router } from 'express';
import { calendarEventSchema, reminderSettingsSchema, type CalendarEvent, type ReminderSettings } from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { broadcast } from '../notify/hub';
import { DEFAULT_REMINDERS } from '../services/overdue';

/** Личное: свои напоминания и свои события календаря. Чужих не видно никому, даже руководителю. */
export const personalRouter = Router();

async function loadReminders(userId: number): Promise<ReminderSettings> {
  const u = await one<{ custom: boolean }>('SELECT reminders_custom AS custom FROM users WHERE id = $1', [userId]);
  if (!u?.custom) return { custom: false, minutes: DEFAULT_REMINDERS.slice().sort((a, b) => b - a) };
  const rows = await many<{ m: number }>('SELECT minutes_before AS m FROM user_reminders WHERE user_id = $1 ORDER BY minutes_before DESC', [userId]);
  return { custom: true, minutes: rows.map((r) => r.m) };
}

personalRouter.get(
  '/me/reminders',
  h(async (req, res) => {
    res.json(await loadReminders(req.user!.id));
  }),
);

/** Заменяет весь набор. Пустой набор — значит, напоминаний не нужно. */
personalRouter.put(
  '/me/reminders',
  h(async (req, res) => {
    const input = parse(reminderSettingsSchema, req.body);
    const minutes = [...new Set(input.minutes)];
    await tx(async (db) => {
      await db.query('UPDATE users SET reminders_custom = true WHERE id = $1', [req.user!.id]);
      await db.query('DELETE FROM user_reminders WHERE user_id = $1', [req.user!.id]);
      for (const m of minutes) await db.query('INSERT INTO user_reminders (user_id, minutes_before) VALUES ($1, $2)', [req.user!.id, m]);
    });
    res.json(await loadReminders(req.user!.id));
  }),
);

/** Вернуть стандартные напоминания. */
personalRouter.delete(
  '/me/reminders',
  h(async (req, res) => {
    await tx(async (db) => {
      await db.query('UPDATE users SET reminders_custom = false WHERE id = $1', [req.user!.id]);
      await db.query('DELETE FROM user_reminders WHERE user_id = $1', [req.user!.id]);
    });
    res.json(await loadReminders(req.user!.id));
  }),
);

const EVENT_SELECT = `SELECT id, title, note, start_at AS "startAt" FROM calendar_events`;

personalRouter.get(
  '/calendar-events',
  h(async (req, res) => {
    const params: unknown[] = [req.user!.id];
    let range = '';
    if (req.query.from && req.query.to) {
      params.push(new Date(String(req.query.from)), new Date(String(req.query.to)));
      range = 'AND start_at >= $2 AND start_at < $3';
    }
    res.json(await many<CalendarEvent>(`${EVENT_SELECT} WHERE user_id = $1 ${range} ORDER BY start_at, id LIMIT 500`, params));
  }),
);

personalRouter.post(
  '/calendar-events',
  h(async (req, res) => {
    const input = parse(calendarEventSchema, req.body);
    const row = await one<{ id: number }>(
      'INSERT INTO calendar_events (user_id, title, note, start_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user!.id, input.title, input.note, input.startAt],
    );
    broadcast('changed', { scopes: ['events'] });
    res.status(201).json({ id: row!.id });
  }),
);

personalRouter.put(
  '/calendar-events/:id',
  h(async (req, res) => {
    const input = parse(calendarEventSchema, req.body);
    const r = await pool.query(
      `UPDATE calendar_events SET title = $3, note = $4,
              remind_from = CASE WHEN start_at <> $5::timestamptz THEN now() ELSE remind_from END, start_at = $5
        WHERE id = $1 AND user_id = $2`,
      [intParam(req.params.id), req.user!.id, input.title, input.note, input.startAt],
    );
    if (!r.rowCount) throw new HttpError(404, 'Событие не найдено');
    broadcast('changed', { scopes: ['events'] });
    res.json({ ok: true });
  }),
);

personalRouter.delete(
  '/calendar-events/:id',
  h(async (req, res) => {
    await pool.query('DELETE FROM calendar_events WHERE id = $1 AND user_id = $2', [intParam(req.params.id), req.user!.id]);
    broadcast('changed', { scopes: ['events'] });
    res.json({ ok: true });
  }),
);
