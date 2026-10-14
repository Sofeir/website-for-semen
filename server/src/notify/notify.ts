import type { NotificationItem } from '@sd/shared';
import { config } from '../config';
import { many, pool } from '../db/pool';
import { channels } from './channels';
import { broadcast, sendTo } from './hub';

export interface Notice {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Копилка уведомлений внутри транзакции. После COMMIT вызываем `flush`,
 * чтобы не уведомлять о том, что откатилось.
 */
export class Outbox {
  notices: Notice[] = [];
  changed = new Set<string>();

  add(n: Notice) {
    this.notices.push(n);
  }

  touch(...scopes: string[]) {
    scopes.forEach((s) => this.changed.add(s));
  }

  async flush() {
    if (this.changed.size) broadcast('changed', { scopes: [...this.changed] });
    if (this.notices.length) await deliver(this.notices);
  }
}

async function deliver(notices: Notice[]) {
  const userIds = [...new Set(notices.map((n) => n.userId))];
  const users = await many<{
    id: number;
    notify_inapp: boolean;
    notify_telegram: boolean;
    notify_max: boolean;
    telegram_chat_id: string | null;
    max_user_id: string | null;
    is_active: boolean;
  }>(
    `SELECT id, notify_inapp, notify_telegram, notify_max, telegram_chat_id, max_user_id, is_active
       FROM users WHERE id = ANY($1)`,
    [userIds],
  );
  const byId = new Map(users.map((u) => [u.id, u]));

  for (const n of notices) {
    const u = byId.get(n.userId);
    if (!u || !u.is_active) continue;
    // Лента и колокольчик есть всегда: настройка notify_inapp отключает только всплывающие сообщения.
    const row = (
      await pool.query<NotificationItem>(
        `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, type, title, body, link, is_read AS "isRead", created_at AS "createdAt"`,
        [n.userId, n.type, n.title, n.body ?? null, n.link ?? null],
      )
    ).rows[0];
    sendTo(n.userId, 'notification', { ...row, toast: u.notify_inapp });

    const url = n.link ? `${config.publicUrl}${n.link}` : null;
    const message = { title: n.title, body: n.body, url };
    for (const ch of channels) {
      if (!ch.isEnabled()) continue;
      const target = ch.id === 'telegram' ? u.notify_telegram && u.telegram_chat_id : u.notify_max && u.max_user_id;
      if (!target) continue;
      ch.send(target, message).catch((e) => console.warn(`[notify:${ch.id}] user ${u.id}: ${(e as Error).message}`));
    }
  }
}
