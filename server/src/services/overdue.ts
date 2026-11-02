import { many, tx } from '../db/pool';
import { Outbox } from '../notify/notify';
import { formatDateTimeRu } from './workTime';

interface OverdueRow {
  id: number;
  title: string;
  assignee_names: string;
  assignee_ids: number[];
  creator_id: number;
  delegator_ids: number[];
  due_at: Date;
}

/**
 * Уведомляет о просроченных задачах один раз на каждую просрочку: всех ответственных, постановщика и тех, кто передал задачу
 * нынешним ответственным. Директорам и админам за всех не шлём: просроченное они смотрят в списке задач.
 * После передачи задачи метка сбрасывается, и просрочка нового исполнителя тоже заметна.
 */
export async function notifyOverdueTasks() {
  const outbox = new Outbox();
  await tx(async (db) => {
    const rows = await many<OverdueRow>(
      `SELECT t.id, t.title, t.creator_id, t.due_at,
              ARRAY(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids,
              (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name) FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignee_names,
              ARRAY(SELECT s.from_user_id FROM task_steps s WHERE s.task_id = t.id AND s.done_at IS NULL AND s.from_user_id IS NOT NULL) AS delegator_ids
         FROM tasks t
        WHERE t.status = 'open' AND t.due_at < now() AND t.overdue_notified_at IS NULL
        FOR UPDATE OF t`,
      [],
      db,
    );
    if (!rows.length) return;
    for (const t of rows) {
      const ids = new Set([...t.assignee_ids, t.creator_id, ...t.delegator_ids]);
      for (const userId of ids) {
        outbox.add({
          userId,
          type: 'task_overdue',
          title: `Просрочена задача: ${t.title}`,
          body: `Исполнитель: ${t.assignee_names}. Срок был — ${formatDateTimeRu(t.due_at)}.`,
          link: `/tasks?task=${t.id}`,
        });
      }
    }
    await db.query('UPDATE tasks SET overdue_notified_at = now() WHERE id = ANY ($1)', [rows.map((r) => r.id)]);
    outbox.touch('tasks', 'dashboard');
  });
  await outbox.flush();
}

interface RemindRow {
  id: number;
  title: string;
  assignee_ids: number[];
  due_at: Date;
}

/**
 * Напоминания ответственным о сроке: за сутки и за 2 часа, каждое один раз.
 * Если задачу поставили уже внутри окна, соответствующее напоминание не шлётся (см. remindReset в services/tasks).
 */
export async function notifyDeadlineReminders() {
  const outbox = new Outbox();
  await tx(async (db) => {
    const send = async (col: 'remind_day_at' | 'remind_2h_at', within: string, title: string) => {
      const rows = await many<RemindRow>(
        `SELECT t.id, t.title, t.due_at, ARRAY(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids
           FROM tasks t
          WHERE t.status = 'open' AND t.due_at > now() AND t.due_at <= now() + interval '${within}' AND t.${col} IS NULL
          FOR UPDATE OF t`,
        [],
        db,
      );
      for (const t of rows) {
        for (const userId of t.assignee_ids) {
          outbox.add({
            userId,
            type: 'task_reminder',
            title: `${title}: ${t.title}`,
            body: `Срок — ${formatDateTimeRu(t.due_at)}.`,
            link: `/tasks?task=${t.id}`,
          });
        }
      }
      if (rows.length) await db.query(`UPDATE tasks SET ${col} = now() WHERE id = ANY ($1)`, [rows.map((r) => r.id)]);
    };
    // Сначала «за 2 часа»: задача, которую впервые заметили уже внутри этого окна, не получит лишнего «за сутки» следом.
    await send('remind_2h_at', '2 hours', 'Через 2 часа срок задачи');
    await db.query(
      `UPDATE tasks SET remind_day_at = now() WHERE status = 'open' AND remind_day_at IS NULL AND due_at <= now() + interval '2 hours'`,
    );
    await send('remind_day_at', '1 day', 'Через сутки срок задачи');
    outbox.touch('tasks');
  });
  await outbox.flush();
}

let lastRun = 0;
let running: Promise<unknown> | null = null;

/** Не чаще раза в минуту: её дёргают «Сегодня» и таймер сервера. */
export function notifyOverdueSoon() {
  if (running || Date.now() - lastRun < 60_000) return running ?? Promise.resolve();
  lastRun = Date.now();
  running = notifyOverdueTasks()
    .then(() => notifyDeadlineReminders())
    .catch((e) => console.error('Уведомления о просрочке:', e.message))
    .finally(() => {
      running = null;
    });
  return running;
}
