import crypto from 'node:crypto';
import { config } from '../config';
import { tx } from '../db/pool';

/** Без похожих знаков (0/O, 1/I): код иногда приходится вводить руками. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const TTL_MIN = 15;

/** Приводит то, что прислал человек, к виду кода: «k7p2-9xqm» и «K7P2 9XQM» тоже подходят. Если это не код, пусто. */
export function normalizeCode(raw: string | null | undefined): string | null {
  const s = String(raw ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return s.length === CODE_LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Новый код для сотрудника. Прежние его коды перестают работать. */
export async function createLinkCode(userId: number) {
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  const row = await tx(async (db) => {
    await db.query('DELETE FROM max_link_codes WHERE user_id = $1 OR expires_at < now()', [userId]);
    return (
      await db.query<{ expiresAt: string }>(
        `INSERT INTO max_link_codes (code, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
         RETURNING expires_at AS "expiresAt"`,
        [code, userId, TTL_MIN],
      )
    ).rows[0];
  });
  return { code, expiresAt: row.expiresAt };
}

/**
 * Привязывает аккаунт Max к сотруднику по коду. Код одноразовый.
 * Если этот аккаунт Max уже был привязан к другому сотруднику, у того привязка снимается.
 */
export async function redeemLinkCode(code: string, maxUserId: number): Promise<{ fullName: string } | null> {
  return tx(async (db) => {
    const hit = (
      await db.query<{ userId: number }>(
        'DELETE FROM max_link_codes WHERE code = $1 AND expires_at > now() RETURNING user_id AS "userId"',
        [code],
      )
    ).rows[0];
    if (!hit) return null;
    // Привязать чужой аккаунт Max может только его владелец (код приходит из этого аккаунта).
    // Прежнему владельцу привязки об этом сообщаем, чтобы переход не прошёл незаметно.
    const taken = (
      await db.query<{ id: number }>(
        'UPDATE users SET max_user_id = NULL, notify_max = false WHERE max_user_id = $1 AND id <> $2 RETURNING id',
        [String(maxUserId), hit.userId],
      )
    ).rows;
    for (const t of taken) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'max_unlinked', 'Max отключён от вашего профиля', $2)`,
        [t.id, 'Этот аккаунт Max подключили к другому сотруднику. Если это ошибка, нажмите «Подключить Max» в профиле ещё раз.'],
      );
    }
    const u = (
      await db.query<{ fullName: string }>(
        'UPDATE users SET max_user_id = $2, notify_max = true WHERE id = $1 RETURNING full_name AS "fullName"',
        [hit.userId, String(maxUserId)],
      )
    ).rows[0];
    return u ?? null;
  });
}

let botName: string | null = null;

/** Ник бота для ссылки https://max.ru/ник?start=код. Узнаём у Max один раз. */
export async function getBotUsername(): Promise<string | null> {
  if (botName) return botName;
  try {
    const res = await fetch(`${config.maxApiUrl.replace(/\/$/, '')}/me`, {
      headers: { Authorization: config.maxBotToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    botName = ((await res.json()) as { username?: string }).username ?? null;
  } catch {
    /* ссылка не получится, останется ввод кода руками */
  }
  return botName;
}

export const _resetBotNameForTests = () => {
  botName = null;
};

