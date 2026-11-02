import { Router } from 'express';
import { many, one } from '../db/pool';
import { h, HttpError } from '../lib/http';
import { buildCalendar, type CalendarTask } from '../services/ical';
import { config } from '../config';

/**
 * Публичная лента задач для подписки из внешнего календаря. Входа в сервис там нет: доступ даёт длинная случайная
 * ссылка из профиля сотрудника. Если ссылка попала не туда, в профиле её можно заменить или отключить.
 */
export const calendarFeedRouter = Router();

calendarFeedRouter.get(
  '/calendar/:file',
  h(async (req, res) => {
    const token = String(req.params.file).replace(/\.ics$/i, '');
    const user = /^[A-Za-z0-9_-]{20,80}$/.test(token)
      ? await one<{ id: number; full_name: string }>(
          'SELECT id, full_name FROM users WHERE calendar_token = $1 AND is_active AND role <> \'customer\'',
          [token],
        )
      : null;
    if (!user) throw new HttpError(404, 'Ссылка на календарь не найдена или отключена');
    const tasks = await many<CalendarTask>(
      `SELECT t.id, t.title, t.description, t.due_at AS "dueAt", t.updated_at AS "updatedAt",
              c.name AS "clientName", o.number AS "orderNumber"
         FROM tasks t
         LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN clients c ON c.id = coalesce(t.client_id, o.client_id)
        WHERE t.status = 'open' AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
        ORDER BY t.due_at LIMIT 500`,
      [user.id],
    );
    const origin = `${req.protocol}://${req.get('host')}`;
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="tasks.ics"',
      'Cache-Control': 'private, max-age=300',
    });
    res.send(buildCalendar(tasks, origin, `Задачи — ${config.appName}`));
  }),
);
