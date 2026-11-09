import type { NotificationItem } from '@sd/shared';
import { config } from '../config';
import { many, pool } from '../db/pool';
import { googleSyncSoon } from '../services/googleCalendar';
import { channels } from './channels';
import { broadcast, sendTo } from './hub';
import { sendPush } from './push';

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

  /** `silent`: уведомления только в ленту, без всплывающих окон (начальное наполнение базы). */
  async flush(opts: { silent?: boolean } = {}) {
    if (this.changed.size) broadcast('changed', { scopes: [...this.changed] });
    // Календари в Google обновляются вслед за задачами
    if (this.changed.has('tasks') || this.changed.has('orders')) googleSyncSoon();
    if (this.notices.length) await deliver(this.notices, opts.silent ?? false);
  }
}

async function pushNotice(userId: number, row: NotificationItem) {
  try {
    const unread = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [userId]))
      .rows[0]!.n;
    await sendPush(userId, { title: row.title, body: row.body, url: row.link, unread, tag: `n-${row.id}` });
  } catch (e) {
    console.warn(`[push] user ${userId}: ${(e as Error).message}`);
  }
}

async function deliver(notices: Notice[], silent: boolean) {
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
        `INSERT INTO notifications (user_id, type, title, body, link, toasted) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, type, title, body, link, is_read AS "isRead", created_at AS "createdAt"`,
        [n.userId, n.type, n.title, n.body ?? null, n.link ?? null, silent],
      )
    ).rows[0];
    if (!silent) {
      // Если человека нет на сайте, окно ему не показано: при следующем входе его отдаст /notifications/missed
      const live = sendTo(n.userId, 'notification', { ...row, toast: u.notify_inapp });
      if (live > 0) await pool.query('UPDATE notifications SET toasted = true WHERE id = $1', [row.id]);
      // Системное уведомление на телефон и компьютер (если устройство подписано). Окно показывает сервис-воркер, когда сайт не открыт на экране.
      void pushNotice(u.id, row);
    }

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
