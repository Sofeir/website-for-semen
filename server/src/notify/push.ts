import * as webpushModule from 'web-push';
import { config } from '../config';
import { many, one, pool } from '../db/pool';

export interface PushPayload {
  title: string;
  body?: string | null;
  /** Куда открыть при нажатии: путь внутри сервиса. */
  url?: string | null;
  /** Сколько непрочитанных, чтобы показать число на значке приложения. */
  unread?: number;
  tag?: string;
}

// web-push — модуль CommonJS: в зависимости от загрузчика (tsx, vitest, сборка) нужные функции лежат либо в default, либо в самом модуле
const webpush: typeof webpushModule = (webpushModule as any).default ?? webpushModule;

let ready: Promise<string> | null = null;

/** Ключи VAPID создаются один раз и лежат в базе: настраивать на сервере ничего не нужно. */
async function init() {
  let row = await one<{ public_key: string; private_key: string }>('SELECT public_key, private_key FROM push_keys WHERE id = 1');
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    await pool.query('INSERT INTO push_keys (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT DO NOTHING', [
      keys.publicKey,
      keys.privateKey,
    ]);
    row = (await one<{ public_key: string; private_key: string }>('SELECT public_key, private_key FROM push_keys WHERE id = 1'))!;
  }
  const subject = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:admin@adminstart.ru';
  webpush.setVapidDetails(subject, row.public_key, row.private_key);
  return row.public_key;
}

/**
 * Куда сервер вообще согласен слать: только https и только службы push самих браузеров. Иначе подписку можно было бы
 * использовать, чтобы заставить сервер обращаться к любому адресу, в том числе внутри сети.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export function pushPublicKey(): Promise<string> {
  if (!ready) {
    ready = init().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Отправляет уведомление на все устройства человека. Устройства, которые отказались принимать (удалили приложение), забываем. */
export async function sendPush(userId: number, payload: PushPayload): Promise<number> {
  const all = await many<SubRow>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  const subs = all.filter((s) => isAllowedPushEndpoint(s.endpoint));
  if (!subs.length) return 0;
  await pushPublicKey();
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: 10_000,
        });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        else console.warn(`[push] user ${userId}: ${(e as Error).message}`);
      }
    }),
  );
  return sent;
}
