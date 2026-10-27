import { config } from '../config';

/**
 * Бот Max отвечает сотруднику его user id: сотрудник пишет боту (или нажимает «Начать») и вписывает этот id в профиле.
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
  /** message_created: сообщение боту. */
  message?: { sender?: MaxUser };
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
    `Ваш id в Max: ${userId}\n` +
    'Впишите его в профиле сайта, в поле «Ваш user id в Max», сохраните и нажмите «Проверить». ' +
    'После этого уведомления будут приходить сюда.'
  );
}

const api = (path: string) => `${config.maxApiUrl.replace(/\/$/, '')}${path}`;

async function reply(userId: number) {
  const res = await fetch(api(`/messages?user_id=${userId}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: config.maxBotToken },
    body: JSON.stringify({ text: replyText(userId) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
          const id = senderOf(u);
          if (id == null) continue;
          await reply(id).catch((e) => console.warn(`[max-bot] ответ ${id}: ${(e as Error).message}`));
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
