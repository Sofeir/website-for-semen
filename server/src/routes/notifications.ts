import { Router } from 'express';
import { can, type DashboardData } from '@sd/shared';
import { many, one, pool } from '../db/pool';
import { h, intParam } from '../lib/http';
import { subscribe } from '../notify/hub';
import { isAssignee, ORDER_SELECT, orderAccess, TASK_AWAITING_ISSUE, TASK_OVERDUE, TASK_SELECT } from '../services/sql';
import { runServicePlansSoon } from '../services/servicePlans';
import { notifyOverdueSoon } from '../services/overdue';
import { endOfDay } from '../services/workTime';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/notifications',
  h(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const onlyUnread = req.query.unread === '1';
    // Для уведомлений о задаче отдаём её нынешнее состояние: «просрочена» в тексте могло устареть, когда задачу закрыли или перенесли срок.
    const items = await many(
      `SELECT n.id, n.type, n.title, n.body, n.link, n.is_read AS "isRead", n.created_at AS "createdAt",
              CASE WHEN t.id IS NULL THEN NULL
                   WHEN t.status <> 'open' THEN 'closed'
                   WHEN ${TASK_AWAITING_ISSUE} THEN 'awaiting'
                   WHEN ${TASK_OVERDUE} THEN 'overdue'
                   ELSE 'open' END AS "taskState",
              t.due_at AS "taskDueAt"
         FROM notifications n
         LEFT JOIN tasks t ON n.link = '/tasks?task=' || t.id
        WHERE n.user_id = $1 ${onlyUnread ? 'AND NOT n.is_read' : ''}
        ORDER BY n.created_at DESC LIMIT $2`,
      [req.user!.id, limit],
    );
    const unread = await one<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [
      req.user!.id,
    ]);
    res.json({ items, unread: unread?.n ?? 0 });
  }),
);

/**
 * Пропущенные всплывающие уведомления: непрочитанные, которые не успели показаться, пока человека не было на сайте.
 * Отдаём один раз: сразу отмечаем показанными, чтобы вторая вкладка или повторный вход не показали их снова.
 */
notificationsRouter.get(
  '/notifications/missed',
  h(async (req, res) => {
    const items = await many(
      `WITH missed AS (
         SELECT n.id FROM notifications n JOIN users u ON u.id = n.user_id
          WHERE n.user_id = $1 AND u.notify_inapp AND NOT n.is_read AND NOT n.toasted
            AND n.created_at > now() - interval '7 days'
          ORDER BY n.created_at DESC LIMIT 20
       )
       UPDATE notifications n SET toasted = true FROM missed
        WHERE n.id = missed.id
       RETURNING n.id, n.type, n.title, n.body, n.link, n.is_read AS "isRead", n.created_at AS "createdAt"`,
      [req.user!.id],
    );
    items.sort((a: any, b: any) => +new Date(a.createdAt) - +new Date(b.createdAt));
    res.json({ items });
  }),
);

notificationsRouter.post(
  '/notifications/read',
  h(async (req, res) => {
    const ids: unknown = req.body?.ids;
    const link: unknown = req.body?.link;
    if (typeof link === 'string' && link.startsWith('/')) {
      // Всё, что относится к одной задаче или заявке, считается прочитанным вместе: человек уже открыл её.
      await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND link = $2 AND NOT is_read', [
        req.user!.id,
        link.slice(0, 300),
      ]);
    } else if (Array.isArray(ids) && ids.length) {
      const clean = ids
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 500);
      await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND id = ANY ($2)', [req.user!.id, clean]);
    } else {
      await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND NOT is_read', [req.user!.id]);
    }
    res.json({ ok: true });
  }),
);

/** Очистить все свои уведомления. Чужие не затрагиваются: у каждого свой список. */
notificationsRouter.delete(
  '/notifications',
  h(async (req, res) => {
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [req.user!.id]);
    res.json({ ok: true });
  }),
);

notificationsRouter.delete(
  '/notifications/:id',
  h(async (req, res) => {
    await pool.query('DELETE FROM notifications WHERE user_id = $1 AND id = $2', [req.user!.id, intParam(req.params.id)]);
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/notifications/:id/read',
  h(async (req, res) => {
    await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND id = $2', [
      req.user!.id,
      intParam(req.params.id),
    ]);
    res.json({ ok: true });
  }),
);

/** Поток событий: новые уведомления и сигналы «данные изменились». */
notificationsRouter.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 5000\nevent: ready\ndata: {}\n\n`);
  const unsubscribe = subscribe(req.user!.id, res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

notificationsRouter.get(
  '/dashboard',
  h(async (req, res) => {
    await Promise.all([runServicePlansSoon(), notifyOverdueSoon()]);
    const user = req.user!;
    const all = can(user.role, 'tasks.manageAll');
    const allOrders = can(user.role, 'orders.viewAll');
    // заявки: руководитель видит все, остальные — свои ($1 — id сотрудника)
    const noOrders = !can(user.role, 'workspace.view');
    const mineO = noOrders ? 'AND false' : allOrders ? '' : `AND ${orderAccess('o', '$1')}`;
    const todayEnd = endOfDay();
    const [myTasksToday, overdue, newOrders, readyOrders, counts] = await Promise.all([
      many(
        `${TASK_SELECT} WHERE ${isAssignee('t', '$1')} AND t.status = 'open' AND t.due_at >= now() AND t.due_at <= $2
          ORDER BY t.due_at LIMIT 50`,
        [user.id, todayEnd],
      ),
      many(
        `${TASK_SELECT} WHERE ${TASK_OVERDUE} ${all ? '' : `AND ${isAssignee('t', '$1')}`}
          ORDER BY t.due_at LIMIT 50`,
        all ? [] : [user.id],
      ),
      many(
        `${ORDER_SELECT} WHERE o.created_at > now() - interval '2 days' ${mineO} ORDER BY o.created_at DESC LIMIT 12`,
        allOrders || noOrders ? [] : [user.id],
      ),
      many(
        `${ORDER_SELECT} WHERE s.id = (SELECT id FROM stages WHERE is_active AND NOT is_final ORDER BY sort DESC, id DESC LIMIT 1)
          ${mineO} ORDER BY o.stage_started_at LIMIT 30`,
        allOrders || noOrders ? [] : [user.id],
      ),
      one(
        `SELECT
           (SELECT count(*) FROM orders o JOIN stages s ON s.id = o.stage_id WHERE NOT s.is_final ${mineO}) AS "inWork",
           (SELECT count(*) FROM orders o WHERE o.stage_id = (SELECT id FROM stages WHERE is_active AND NOT is_final ORDER BY sort DESC, id DESC LIMIT 1) ${mineO}) AS ready,
           (SELECT count(*) FROM tasks t WHERE ${TASK_OVERDUE} ${all ? '' : `AND ${isAssignee('t', '$1')}`}) AS overdue,
           (SELECT count(*) FROM tasks t WHERE t.status = 'open' AND ${isAssignee('t', '$1')} AND t.due_at <= $2) AS today`,
        [user.id, todayEnd],
      ),
    ]);
    const data: DashboardData = {
      myTasksToday,
      overdue,
      overdueScope: all ? 'all' : 'mine',
      newOrders,
      readyOrders,
      counts: counts as DashboardData['counts'],
    };
    res.json(data);
  }),
);
