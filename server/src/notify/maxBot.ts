import { config } from '../config';
import { normalizeCode, redeemLinkCode } from './maxLink';

/**
 * Бот Max подключает сотрудника к уведомлениям. Сотрудник нажимает «Подключить Max» в профиле, открывает бота по ссылке
 * (или присылает ему код), и сервер сам запоминает его аккаунт Max. Если кода нет, бот отвечает user id, его можно вписать руками.
 * Обновления забираем длинным опросом (GET /updates): сервер стоит в закрытой сети, и принимающий адрес (webhook) ему не нужен.
 * Без токена бота ничего не запускается.
 */

interface MaxUser {
  user_id: number;
  is_bot?: boolean;
}

export interface MaxUpdate {
  update_type: string;
  /** bot_started: кто нажал «Начать». */
  user?: MaxUser;
  /** bot_started по ссылке с ?start=…: то, что стоит после start=. */
  payload?: string | null;
  /** message_created: сообщение боту. */
  message?: { sender?: MaxUser; body?: { text?: string | null } };
}

/** Кому отвечать: человеку, который нажал «Начать» или написал боту. Сообщения ботов и каналов пропускаем. */
export function senderOf(u: MaxUpdate): number | null {
  if (u.update_type === 'bot_started') return u.user?.user_id ?? null;
  if (u.update_type === 'message_created') {
    const s = u.message?.sender;
    return s && !s.is_bot ? s.user_id : null;
  }
  return null;
}

export function replyText(userId: number) {
  return (
    'Чтобы подключить уведомления, откройте свой профиль на сайте и нажмите «Подключить Max». Сайт покажет ссылку и код.\n' +
    `Если подключить не получается, впишите вручную свой id в Max: ${userId}`
  );
}

export const linkedText = (fullName: string) => `Готово, вы подключены: ${fullName}. Уведомления будут приходить сюда.`;
export const badCodeText = 'Код не подходит или устарел. В профиле на сайте нажмите «Подключить Max» ещё раз.';

const api = (path: string) => `${config.maxApiUrl.replace(/\/$/, '')}${path}`;

async function send(userId: number, text: string) {
  const res = await fetch(api(`/messages?user_id=${userId}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: config.maxBotToken },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Что сделать с одним сообщением боту: подключить по коду или подсказать, как подключиться. */
export async function processUpdate(u: MaxUpdate, say: (userId: number, text: string) => Promise<void> = send) {
  const id = senderOf(u);
  if (id == null) return;
  const text = u.update_type === 'bot_started' ? u.payload : u.message?.body?.text;
  const code = normalizeCode(text);
  if (code) {
    const user = await redeemLinkCode(code, id);
    return say(id, user ? linkedText(user.fullName) : badCodeText);
  }
  return say(id, replyText(id));
}

/** Один запрос к /updates: ждёт до 30 секунд, пока придёт что-то новое. */
export async function pollOnce(marker: number | null): Promise<{ updates: MaxUpdate[]; marker: number | null }> {
  const q = new URLSearchParams({ timeout: '30', limit: '100', types: 'bot_started,message_created' });
  if (marker != null) q.set('marker', String(marker));
  const res = await fetch(api(`/updates?${q}`), {
    headers: { Authorization: config.maxBotToken },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { updates?: MaxUpdate[]; marker?: number | null };
  return { updates: data.updates ?? [], marker: data.marker ?? marker };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Запускает опрос в фоне. Ошибки связи не роняют сервер: пауза растёт до минуты, при неверном токене проверка раз в 5 минут. */
export function startMaxBot() {
  if (!config.maxBotToken) return () => {};
  let stopped = false;
  let marker: number | null = null;
  let failures = 0;
  const loop = async () => {
    while (!stopped) {
      const started = Date.now();
      try {
        const r = await pollOnce(marker);
        marker = r.marker;
        if (failures) console.log('[max-bot] связь восстановлена');
        failures = 0;
        for (const u of r.updates) {
          await processUpdate(u).catch((e) => console.warn(`[max-bot] обработка сообщения: ${(e as Error).message}`));
        }
        // если сервер вернул пустой ответ сразу, не крутим цикл вхолостую
        if (!r.updates.length && Date.now() - started < 1000) await sleep(1000);
      } catch (e) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) console.warn(`[max-bot] не удалось получить сообщения: ${(e as Error).message}`);
        await sleep(/HTTP 401/.test((e as Error).message) ? 300_000 : Math.min(60_000, 2000 * 2 ** Math.min(failures, 5)));
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
