import { config } from '../config';
import { many, one, pool } from '../db/pool';
import { DEFAULT_REMINDERS } from '@sd/shared';
import { formatDateTimeRu } from './workTime';

/**
 * Запись задач и событий в Google Календарь сотрудника.
 * Основной способ — вход через Google: сотрудник нажимает «Подключить», разрешает доступ, и сервис пишет в его основной календарь
 * сам (ключи приложения GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в .env). Запасной — сервисный аккаунт (файл ключа на сервере,
 * сотрудник делится календарём с его адресом).
 * Node-модули подключаются на лету: в демо-сборке (весь сервер в браузере) этот код не запускается.
 */

interface ServiceKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const OAUTH_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let keyCache: ServiceKey | null | undefined;
let tokenCache: { value: string; expires: number } | null = null;

/** Для тестов: подставить ключ и сбросить токен. */
export function _setGoogleKeyForTests(key: ServiceKey | null) {
  keyCache = key;
  tokenCache = null;
  userTokens.clear();
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

/** Есть ли вход через Google (ключи приложения в .env). */
export const googleOauthConfigured = () => Boolean(config.googleClientId && config.googleClientSecret);

/** Включена ли запись в календари хоть одним способом. */
export async function googleConfigured() {
  return googleOauthConfigured() || Boolean(await loadKey());
}

/** Адрес сервисного аккаунта: с ним сотрудник делится календарём (запасной способ). */
export async function googleServiceEmail() {
  return (await loadKey())?.client_email ?? null;
}

export class GoogleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------- токен сервисного аккаунта ----------

async function accessToken(): Promise<string> {
  const key = await loadKey();
  if (!key) throw new Error('Сервер не подключён к Google: нет ключа сервисного аккаунта');
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.value;
  const spec = 'node:crypto';
  const { createSign } = (await import(/* @vite-ignore */ spec)) as typeof import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const aud = key.token_uri || TOKEN_URL;
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

// ---------- вход через Google (OAuth) ----------

/** Ключ шифрования токенов сотрудников: из секрета приложения. Токены в базе лежат только зашифрованными. */
async function sealKey() {
  const raw = new TextEncoder().encode(`sd-google-token:${config.googleClientSecret}`);
  return globalThis.crypto.subtle.importKey('raw', await globalThis.crypto.subtle.digest('SHA-256', raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sealSecret(plain: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(), new TextEncoder().encode(plain)));
  return `${toB64(iv)}.${toB64(ct)}`;
}

export async function openSecret(sealed: string): Promise<string> {
  const [iv, ct] = sealed.split('.');
  if (!iv || !ct) throw new Error('повреждённый токен');
  return new TextDecoder().decode(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await sealKey(), fromB64(ct)));
}

const redirectUri = () => `${config.publicUrl.replace(/\/$/, '')}/api/google/callback`;

/** Адрес, куда отправить сотрудника, чтобы он разрешил доступ к своему календарю. */
export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    // prompt=consent: Google выдаёт долгоживущий (refresh) токен, даже если сотрудник подключался раньше
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Меняет код, который вернул Google, на долгоживущий токен. */
export async function exchangeGoogleCode(code: string): Promise<{ refreshToken: string; email: string | null }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error?: string };
  if (!res.ok || !data.refresh_token) throw new GoogleError(res.status, data.error === 'invalid_grant' ? 'Код подключения устарел, попробуйте ещё раз' : `Google не выдал доступ (${res.status})`);
  let email: string | null = null;
  try {
    const payload = data.id_token?.split('.')[1];
    if (payload) email = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string }).email ?? null;
  } catch {
    email = null;
  }
  return { refreshToken: data.refresh_token, email };
}

const userTokens = new Map<number, { value: string; expires: number }>();

/** Доступ от имени сотрудника. Если он отозвал разрешение или токен истёк, подключение сбрасывается и в профиле просят подключить заново. */
async function userAccessToken(userId: number): Promise<string> {
  const cached = userTokens.get(userId);
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  const u = await one<{ t: string | null }>('SELECT google_refresh_token AS t FROM users WHERE id = $1', [userId]);
  if (!u?.t) throw new GoogleError(401, 'Календарь не подключён');
  let refresh: string;
  try {
    refresh = await openSecret(u.t);
  } catch {
    await dropUserAuth(userId);
    throw new GoogleError(401, 'Подключение к Google нужно сделать заново');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      await dropUserAuth(userId);
      throw new GoogleError(401, 'Доступ к календарю Google отозван или истёк: подключите его заново в профиле');
    }
    throw new GoogleError(res.status, `Google не выдал доступ (${res.status})`);
  }
  userTokens.set(userId, { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

async function dropUserAuth(userId: number) {
  userTokens.delete(userId);
  await pool.query('UPDATE users SET google_refresh_token = NULL, google_email = NULL WHERE id = $1', [userId]);
}

// ---------- запросы к календарю ----------

type Token = () => Promise<string>;

async function gcal<T = unknown>(method: string, path: string, body: object | undefined, token: Token): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new GoogleError(res.status, data.error?.message || `Google ответил ${res.status}`);
  return data;
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}/events`;

/** Описание календаря: в нём сотрудник оставляет код, подтверждающий, что календарь его (запасной способ). */
export async function googleCalendarDescription(calendarId: string): Promise<string> {
  const meta = await gcal<{ description?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}`, undefined, accessToken);
  return meta?.description ?? '';
}

/** Проверка доступа: можно ли читать календарь. Ошибка доступа — GoogleError 404 или 403. */
export async function googleCheckCalendar(calendarId: string) {
  await gcal('GET', `${cal(calendarId)}?maxResults=1`, undefined, accessToken);
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

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  due_at: Date;
  status: string;
  closed_at: Date | null;
  client_name: string | null;
  order_number: string | null;
  stage_name: string | null;
  device_title: string | null;
}

/**
 * Что должно лежать в календаре: всё, что человек видит в календаре сервиса. Открытые задачи, личные события и недавно закрытые обычные задачи.
 * Этапы заявки показываются одной записью на заявку (текущий этап), закрытые этапы в календарь не идут.
 */
async function desiredFor(userId: number): Promise<Desired[]> {
  const minutes = await reminderMinutes(userId);
  const reminders = { useDefault: false, overrides: minutes.map((m) => ({ method: 'popup', minutes: m })) };
  const tasks = await many<TaskRow>(
    `SELECT t.id, t.title, t.description, t.due_at, t.status, t.closed_at, c.name AS client_name, o.number AS order_number,
            (SELECT sg.name FROM stages sg WHERE sg.id = t.stage_id) AS stage_name,
            (SELECT concat_ws(' ', dt.name, coalesce(b.name, d.brand_text), coalesce(m.name, d.model_text))
               FROM devices d JOIN device_types dt ON dt.id = d.device_type_id
               LEFT JOIN brands b ON b.id = d.brand_id LEFT JOIN models m ON m.id = d.model_id WHERE d.id = o.device_id) AS device_title
       FROM tasks t
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN clients c ON c.id = coalesce(t.client_id, o.client_id)
      WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
        AND (
          (t.status = 'open' AND t.due_at > now() - interval '1 day' AND t.due_at < now() + interval '180 days')
          OR (t.status <> 'open' AND t.stage_id IS NULL AND t.closed_at > now() - interval '7 days')
        )
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
    const done = t.status !== 'open';
    // Этап заявки в календаре — это заявка: «Заявка №001107: Компьютер Сборка Офисный ПК (Ремонт)»
    const summary = t.stage_name && t.order_number
      ? `Заявка №${t.order_number}: ${t.device_title ?? ''} (${t.stage_name})`.replace(/\s+\(/, ' (')
      : `${done ? '✓ ' : 'Крайний срок: '}${t.title}`;
    out.push({
      key: `task:${t.id}`,
      kind: 'task',
      ref: t.id,
      body: {
        summary,
        description: [t.description, t.client_name && `Клиент: ${t.client_name}`, t.order_number && `Заявка №${t.order_number}`, `Срок — ${formatDateTimeRu(t.due_at)}`, link]
          .filter(Boolean)
          .join('\n'),
        start: { dateTime: iso(new Date(t.due_at.getTime() - 30 * 60_000)) },
        end: { dateTime: iso(t.due_at) },
        // закрытое — серым и без напоминаний
        ...(done ? { colorId: '8', reminders: { useDefault: false, overrides: [] } } : { reminders }),
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

interface SyncTarget {
  calendarId: string;
  token: Token;
}

/** Куда писать у сотрудника: основной календарь по его входу через Google или календарь, которым он поделился с сервисным аккаунтом. */
async function targetOf(userId: number): Promise<SyncTarget | null> {
  const u = await one<{ calendar_id: string | null; t: string | null }>(
    'SELECT google_calendar_id AS calendar_id, google_refresh_token AS t FROM users WHERE id = $1 AND is_active',
    [userId],
  );
  if (u?.t && googleOauthConfigured()) return { calendarId: 'primary', token: () => userAccessToken(userId) };
  if (u?.calendar_id) return { calendarId: u.calendar_id, token: accessToken };
  return null;
}

/** Приводит календарь сотрудника в соответствие с задачами и событиями: добавляет, обновляет, убирает лишнее. */
export async function syncGoogleUser(userId: number): Promise<{ created: number; updated: number; removed: number }> {
  const stats = { created: 0, updated: 0, removed: 0 };
  if (running.has(userId)) return stats;
  running.add(userId);
  try {
    const target = await targetOf(userId);
    if (!target) return stats;
    const { calendarId, token } = target;
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
            await gcal('PATCH', `${cal(calendarId)}/${encodeURIComponent(have.google_id)}`, d.body, token);
            await save(d, have.google_id, fp);
            stats.updated++;
            continue;
          } catch (e) {
            // событие удалили руками в Google: создадим заново
            if (!(e instanceof GoogleError) || (e.status !== 404 && e.status !== 410)) throw e;
          }
        }
        const made = await gcal<{ id: string }>('POST', cal(calendarId), d.body, token);
        await save(d, made!.id, fp);
        stats.created++;
      }
      // что осталось в соответствии, а в задачах и событиях уже нет (закрыто, удалено, срок далеко): убираем из Google
      for (const stale of byKey.values()) {
        try {
          await gcal('DELETE', `${cal(calendarId)}/${encodeURIComponent(stale.google_id)}`, undefined, token);
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
export async function clearGoogleUser(userId: number) {
  const target = await targetOf(userId).catch(() => null);
  const mapped = await many<{ google_id: string }>('SELECT google_id FROM google_events WHERE user_id = $1', [userId]);
  if (target) {
    for (const m of mapped) {
      try {
        await gcal('DELETE', `${cal(target.calendarId)}/${encodeURIComponent(m.google_id)}`, undefined, target.token);
      } catch {
        // календарь мог быть закрыт или событие удалено: не мешаем отключению
      }
    }
  }
  await pool.query('DELETE FROM google_events WHERE user_id = $1', [userId]);
  userTokens.delete(userId);
}

export async function syncAllGoogle() {
  if (!(await googleConfigured())) return;
  const users = await many<{ id: number }>(
    'SELECT id FROM users WHERE is_active AND (google_calendar_id IS NOT NULL OR google_refresh_token IS NOT NULL) ORDER BY id',
  );
  for (const u of users) await syncGoogleUser(u.id);
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** После изменений задач и событий: подождать пару секунд, чтобы собрать правки пачкой, и обновить календари. */
export function googleSyncSoon(delayMs = 4000) {
  if (!(config.googleKeyFile || googleOauthConfigured()) || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncAllGoogle().catch((e) => console.error('Google Календарь:', (e as Error).message));
  }, delayMs);
  timer.unref?.();
}
