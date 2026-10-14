import { config } from '../config';

export interface OutgoingMessage {
  title: string;
  body?: string | null;
  /** Абсолютная ссылка на экран в сервисе. */
  url?: string | null;
}

/**
 * Внешний канал уведомлений. Новый мессенджер = новая реализация этого интерфейса
 * плюс поле адресата у пользователя.
 */
export interface NotificationChannel {
  readonly id: 'telegram' | 'max';
  readonly label: string;
  /** Канал включён, если на сервере задан токен бота. */
  isEnabled(): boolean;
  send(target: string, message: OutgoingMessage): Promise<void>;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(m: OutgoingMessage) {
  const parts = [`<b>${escapeHtml(m.title)}</b>`];
  if (m.body) parts.push(escapeHtml(m.body));
  if (m.url) parts.push(`<a href="${escapeHtml(m.url)}">Открыть в сервисе</a>`);
  return parts.join('\n');
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

export const telegramChannel: NotificationChannel = {
  id: 'telegram',
  label: 'Telegram',
  isEnabled: () => Boolean(config.telegramBotToken),
  async send(chatId, m) {
    await postJson(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      chat_id: chatId,
      text: toHtml(m),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  },
};

/** Max Bot API: POST /messages?user_id=…, токен в заголовке Authorization. */
export const maxChannel: NotificationChannel = {
  id: 'max',
  label: 'Max',
  isEnabled: () => Boolean(config.maxBotToken),
  async send(userId, m) {
    const url = `${config.maxApiUrl.replace(/\/$/, '')}/messages?user_id=${encodeURIComponent(userId)}`;
    await postJson(url, { text: toHtml(m), format: 'html' }, { Authorization: config.maxBotToken });
  },
};

export const channels: NotificationChannel[] = [telegramChannel, maxChannel];
