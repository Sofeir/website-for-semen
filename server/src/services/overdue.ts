import { many, tx } from '../db/pool';
import { Outbox } from '../notify/notify';
import { overseerIds } from './tasks';
import { formatDateTimeRu } from './workTime';

interface OverdueRow {
  id: number;
  title: string;
  assignee_id: number;
  assignee_name: string;
  creator_id: number;
  delegator_id: number | null;
  due_at: Date;
}

/**
 * Уведомляет о просроченных задачах один раз на каждую просрочку: исполнителя, того, кто передал ему задачу,
 * постановщика и руководителей. После передачи задачи метка сбрасывается, и просрочка нового исполнителя тоже заметна.
 */
export async function notifyOverdueTasks() {
  const outbox = new Outbox();
  await tx(async (db) => {
    const rows = await many<OverdueRow>(
      `SELECT t.id, t.title, t.assignee_id, ua.full_name AS assignee_name, t.creator_id, t.due_at,
              (SELECT s.from_user_id FROM task_steps s WHERE s.task_id = t.id AND s.done_at IS NULL ORDER BY s.id DESC LIMIT 1) AS delegator_id
         FROM tasks t JOIN users ua ON ua.id = t.assignee_id
        WHERE t.status = 'open' AND t.due_at < now() AND t.overdue_notified_at IS NULL
        FOR UPDATE OF t`,
      [],
      db,
    );
    if (!rows.length) return;
    const overseers = await overseerIds(db);
    for (const t of rows) {
      const ids = new Set([t.assignee_id, t.creator_id, t.delegator_id, ...overseers].filter((x): x is number => Boolean(x)));
      for (const userId of ids) {
        outbox.add({
          userId,
          type: 'task_overdue',
          title: `Просрочена задача: ${t.title}`,
          body: `Исполнитель: ${t.assignee_name}. Срок был — ${formatDateTimeRu(t.due_at)}.`,
          link: `/tasks?task=${t.id}`,
        });
      }
    }
    await db.query('UPDATE tasks SET overdue_notified_at = now() WHERE id = ANY ($1)', [rows.map((r) => r.id)]);
    outbox.touch('tasks', 'dashboard');
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
    .catch((e) => console.error('Уведомления о просрочке:', e.message))
    .finally(() => {
      running = null;
    });
  return running;
}
