import { config } from '../config';
import { many, one, pool } from '../db/pool';
import { DEFAULT_REMINDERS } from '@sd/shared';
import { formatDateTimeRu } from './workTime';

/**
 * Запись задач и событий в Google Календарь сотрудника через сервисный аккаунт.
 * Ключ аккаунта лежит файлом на сервере (GOOGLE_SERVICE_ACCOUNT_FILE) и никуда не отдаётся.
 * Node-модули подключаются на лету: в демо-сборке (весь сервер в браузере) этот код не запускается.
 */

interface ServiceKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const API = 'https://www.googleapis.com/calendar/v3';

let keyCache: ServiceKey | null | undefined;
let tokenCache: { value: string; expires: number } | null = null;

/** Для тестов: подставить ключ и сбросить токен. */
export function _setGoogleKeyForTests(key: ServiceKey | null) {
  keyCache = key;
  tokenCache = null;
}

async function loadKey(): Promise<ServiceKey | null> {
  if (keyCache !== undefined) return keyCache;
  if (!config.googleKeyFile) return (keyCache = null);
  try {
    const spec = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ spec)) as typeof import('node:fs/promises');
    const raw = JSON.parse(await fs.readFile(config.googleKeyFile, 'utf8'));
    if (typeof raw.client_email !== 'string' || typeof raw.private_key !== 'string') throw new Error('в файле нет client_email или private_key');
    keyCache = { client_email: raw.client_email, private_key: raw.private_key, token_uri: raw.token_uri };
  } catch (e) {
    console.error('Google Календарь: не удалось прочитать ключ сервисного аккаунта:', (e as Error).message);
    keyCache = null;
  }
  return keyCache;
}

export async function googleConfigured() {
  return Boolean(await loadKey());
}

/** Адрес сервисного аккаунта: с ним сотрудник делится календарём. */
export async function googleServiceEmail() {
  return (await loadKey())?.client_email ?? null;
}

async function accessToken(): Promise<string> {
  const key = await loadKey();
  if (!key) throw new Error('Сервер не подключён к Google: нет ключа сервисного аккаунта');
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.value;
  const spec = 'node:crypto';
  const { createSign } = (await import(/* @vite-ignore */ spec)) as typeof import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const aud = key.token_uri || 'https://oauth2.googleapis.com/token';
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new Error(`Google не выдал доступ (${res.status})`);
  tokenCache = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return tokenCache.value;
}

export class GoogleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gcal<T = unknown>(method: string, path: string, body?: object): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new GoogleError(res.status, data.error?.message || `Google ответил ${res.status}`);
  return data;
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}/events`;

/** Описание календаря: в нём сотрудник оставляет код, подтверждающий, что календарь его. */
export async function googleCalendarDescription(calendarId: string): Promise<string> {
  const meta = await gcal<{ description?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}`);
  return meta?.description ?? '';
}

/** Проверка доступа: можно ли читать календарь. Ошибка доступа — GoogleError 404 или 403. */
export async function googleCheckCalendar(calendarId: string) {
  await gcal('GET', `${cal(calendarId)}?maxResults=1`);
}

interface Desired {
  key: string;
  kind: 'task' | 'event';
  ref: number;
  body: Record<string, unknown>;
}

const iso = (d: Date) => d.toISOString();

async function reminderMinutes(userId: number): Promise<number[]> {
  const u = await one<{ custom: boolean }>('SELECT reminders_custom AS custom FROM users WHERE id = $1', [userId]);
  const list = u?.custom
    ? (await many<{ m: number }>('SELECT minutes_before AS m FROM user_reminders WHERE user_id = $1 ORDER BY minutes_before DESC', [userId])).map((r) => r.m)
    : DEFAULT_REMINDERS;
  // Google принимает до 5 напоминаний и не больше 4 недель
  return list.filter((m) => m <= 40320).slice(0, 5);
}

async function desiredFor(userId: number): Promise<Desired[]> {
  const minutes = await reminderMinutes(userId);
  const reminders = { useDefault: false, overrides: minutes.map((m) => ({ method: 'popup', minutes: m })) };
  const tasks = await many<{ id: number; title: string; description: string | null; due_at: Date; client_name: string | null; order_number: string | null }>(
    `SELECT t.id, t.title, t.description, t.due_at, c.name AS client_name, o.number AS order_number
       FROM tasks t
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN clients c ON c.id = coalesce(t.client_id, o.client_id)
      WHERE t.status = 'open' AND t.due_at > now() - interval '1 day' AND t.due_at < now() + interval '180 days'
        AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
      ORDER BY t.due_at LIMIT 300`,
    [userId],
  );
  const events = await many<{ id: number; title: string; note: string | null; start_at: Date }>(
    `SELECT id, title, note, start_at FROM calendar_events
      WHERE user_id = $1 AND start_at > now() - interval '1 day' AND start_at < now() + interval '365 days' ORDER BY start_at LIMIT 300`,
    [userId],
  );
  const out: Desired[] = [];
  for (const t of tasks) {
    const link = `${config.publicUrl.replace(/\/$/, '')}/tasks?task=${t.id}`;
    out.push({
      key: `task:${t.id}`,
      kind: 'task',
      ref: t.id,
      body: {
        summary: `Крайний срок: ${t.title}`,
        description: [t.description, t.client_name && `Клиент: ${t.client_name}`, t.order_number && `Заявка №${t.order_number}`, `Срок — ${formatDateTimeRu(t.due_at)}`, link]
          .filter(Boolean)
          .join('\n'),
        start: { dateTime: iso(new Date(t.due_at.getTime() - 30 * 60_000)) },
        end: { dateTime: iso(t.due_at) },
        reminders,
      },
    });
  }
  for (const e of events) {
    out.push({
      key: `event:${e.id}`,
      kind: 'event',
      ref: e.id,
      body: {
        summary: e.title,
        description: e.note ?? '',
        start: { dateTime: iso(e.start_at) },
        end: { dateTime: iso(new Date(e.start_at.getTime() + 30 * 60_000)) },
        reminders,
      },
    });
  }
  return out;
}

const running = new Set<number>();

/** Приводит календарь сотрудника в соответствие с задачами и событиями: добавляет, обновляет, убирает лишнее. */
export async function syncGoogleUser(userId: number): Promise<{ created: number; updated: number; removed: number }> {
  const stats = { created: 0, updated: 0, removed: 0 };
  if (running.has(userId)) return stats;
  running.add(userId);
  try {
    const u = await one<{ calendar_id: string | null }>('SELECT google_calendar_id AS calendar_id FROM users WHERE id = $1 AND is_active', [userId]);
    if (!u?.calendar_id) return stats;
    try {
      const desired = await desiredFor(userId);
      const mapped = await many<{ kind: 'task' | 'event'; ref_id: number; google_id: string; fingerprint: string }>(
        'SELECT kind, ref_id, google_id, fingerprint FROM google_events WHERE user_id = $1',
        [userId],
      );
      const byKey = new Map(mapped.map((m) => [`${m.kind}:${m.ref_id}`, m]));
      const save = (d: Desired, googleId: string, fp: string) =>
        pool.query(
          `INSERT INTO google_events (kind, ref_id, user_id, google_id, fingerprint) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (kind, ref_id, user_id) DO UPDATE SET google_id = EXCLUDED.google_id, fingerprint = EXCLUDED.fingerprint`,
          [d.kind, d.ref, userId, googleId, fp],
        );
      for (const d of desired) {
        const fp = JSON.stringify(d.body);
        const have = byKey.get(d.key);
        byKey.delete(d.key);
        if (have && have.fingerprint === fp) continue;
        if (have) {
          try {
            await gcal('PATCH', `${cal(u.calendar_id)}/${encodeURIComponent(have.google_id)}`, d.body);
            await save(d, have.google_id, fp);
            stats.updated++;
            continue;
          } catch (e) {
            // событие удалили руками в Google: создадим заново
            if (!(e instanceof GoogleError) || (e.status !== 404 && e.status !== 410)) throw e;
          }
        }
        const made = await gcal<{ id: string }>('POST', cal(u.calendar_id), d.body);
        await save(d, made!.id, fp);
        stats.created++;
      }
      // что осталось в соответствии, а в задачах и событиях уже нет (закрыто, удалено, срок далеко): убираем из Google
      for (const stale of byKey.values()) {
        try {
          await gcal('DELETE', `${cal(u.calendar_id)}/${encodeURIComponent(stale.google_id)}`);
        } catch (e) {
          if (!(e instanceof GoogleError) || (e.status !== 404 && e.status !== 410)) throw e;
        }
        await pool.query('DELETE FROM google_events WHERE kind = $1 AND ref_id = $2 AND user_id = $3', [stale.kind, stale.ref_id, userId]);
        stats.removed++;
      }
      await pool.query('UPDATE users SET google_sync_at = now(), google_sync_error = NULL WHERE id = $1', [userId]);
    } catch (e) {
      await pool.query('UPDATE users SET google_sync_error = $2 WHERE id = $1', [userId, (e as Error).message.slice(0, 300)]);
    }
    return stats;
  } finally {
    running.delete(userId);
  }
}

/** Убирает из Google всё, что записал сервис, когда сотрудник отключает синхронизацию. */
export async function clearGoogleUser(userId: number, calendarId: string | null) {
  const mapped = await many<{ google_id: string }>('SELECT google_id FROM google_events WHERE user_id = $1', [userId]);
  if (calendarId) {
    for (const m of mapped) {
      try {
        await gcal('DELETE', `${cal(calendarId)}/${encodeURIComponent(m.google_id)}`);
      } catch {
        // календарь мог быть закрыт или событие удалено: не мешаем отключению
      }
    }
  }
  await pool.query('DELETE FROM google_events WHERE user_id = $1', [userId]);
}

export async function syncAllGoogle() {
  if (!(await googleConfigured())) return;
  const users = await many<{ id: number }>('SELECT id FROM users WHERE is_active AND google_calendar_id IS NOT NULL ORDER BY id');
  for (const u of users) await syncGoogleUser(u.id);
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** После изменений задач и событий: подождать пару секунд, чтобы собрать правки пачкой, и обновить календари. */
export function googleSyncSoon(delayMs = 4000) {
  if (!config.googleKeyFile || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncAllGoogle().catch((e) => console.error('Google Календарь:', (e as Error).message));
  }, delayMs);
  timer.unref?.();
}
