import { DEFAULT_REMINDERS, pluralRu } from '@sd/shared';
import { many, tx, type Db } from '../db/pool';
import { Outbox } from '../notify/notify';
import { taskContext } from './context';
import { TASK_AWAITING_ISSUE } from './sql';
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
 * Уведомляет о просроченных задачах один раз на каждую просрочку: всех ответственных, постановщика, тех, кто передал задачу
 * нынешним ответственным, и директора (тот, кто подтверждает просрочку). Остальным руководителям за всех не шлём.
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
        WHERE t.status = 'open' AND t.due_at < now() AND t.overdue_notified_at IS NULL AND NOT ${TASK_AWAITING_ISSUE}
        FOR UPDATE OF t`,
      [],
      db,
    );
    if (!rows.length) return;
    // Тот, кто подтверждает просрочку (директор), узнаёт о каждой просроченной задаче: ему же её потом подтверждать
    const directors = (await many<{ id: number }>('SELECT id FROM users WHERE is_active AND confirms_overdue', [], db)).map((u) => u.id);
    for (const t of rows) {
      const ids = new Set([...t.assignee_ids, t.creator_id, ...t.delegator_ids, ...directors]);
      const ctx = await taskContext(db, t.id);
      for (const userId of ids) {
        outbox.add({
          userId,
          type: 'task_overdue',
          title: `Просрочена задача: ${t.title}`,
          body: [`Исполнитель: ${t.assignee_names}. Крайний срок был — ${formatDateTimeRu(t.due_at)}.`, ...ctx].join('\n'),
          link: `/tasks?task=${t.id}`,
        });
      }
    }
    await db.query('UPDATE tasks SET overdue_notified_at = now() WHERE id = ANY ($1)', [rows.map((r) => r.id)]);
    outbox.touch('tasks', 'dashboard');
  });
  await outbox.flush();
}

/** «1440» → «1 день», «120» → «2 часа», «15» → «15 минут». */
export function reminderLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${pluralRu(d, 'день', 'дня', 'дней')}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${pluralRu(h, 'час', 'часа', 'часов')}`;
  }
  return `${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')}`;
}

interface RemindTarget {
  kind: 'task' | 'event';
  id: number;
  title: string;
  at: Date;
  from: Date;
  userIds: number[];
}

/** Сколько минут напоминаний у каждого сотрудника: свои или стандартные. */
async function reminderRules(db: Db): Promise<Map<number, number[]>> {
  const users = await many<{ id: number; custom: boolean }>(`SELECT id, reminders_custom AS custom FROM users WHERE is_active`, [], db);
  const own = await many<{ user_id: number; minutes_before: number }>(`SELECT user_id, minutes_before FROM user_reminders`, [], db);
  const byUser = new Map<number, number[]>();
  for (const r of own) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.minutes_before]);
  const rules = new Map<number, number[]>();
  for (const u of users) rules.set(u.id, (u.custom ? (byUser.get(u.id) ?? []) : DEFAULT_REMINDERS).slice().sort((a, b) => a - b));
  return rules;
}

/**
 * Напоминания о крайнем сроке задач и о начале личных событий: у каждого сотрудника свой набор («за N минут до»).
 * Каждое напоминание уходит один раз на срок. Если сразу несколько напоминаний уже «созрели» (сервер долго не работал),
 * шлём только ближайшее по времени, остальные считаем отправленными. Напоминание, время которого прошло ещё до постановки
 * задачи или до смены срока (remind_from), не шлётся.
 */
export async function notifyDeadlineReminders() {
  const outbox = new Outbox();
  await tx(async (db) => {
    const rules = await reminderRules(db);
    const horizon = Math.max(1, ...[...rules.values()].flat());
    const targets: RemindTarget[] = [
      ...(
        await many<{ id: number; title: string; at: Date; from: Date; user_ids: number[] }>(
          `SELECT t.id, t.title, t.due_at AS at, t.remind_from AS "from", ARRAY(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id) AS user_ids
             FROM tasks t
            WHERE t.status = 'open' AND t.due_at > now() AND t.due_at <= now() + make_interval(mins => $1)`,
          [horizon],
          db,
        )
      ).map((r) => ({ kind: 'task' as const, id: r.id, title: r.title, at: r.at, from: r.from, userIds: r.user_ids })),
      ...(
        await many<{ id: number; title: string; at: Date; from: Date; user_id: number }>(
          `SELECT e.id, e.title, e.start_at AS at, e.remind_from AS "from", e.user_id
             FROM calendar_events e
            WHERE e.start_at > now() AND e.start_at <= now() + make_interval(mins => $1)`,
          [horizon],
          db,
        )
      ).map((r) => ({ kind: 'event' as const, id: r.id, title: r.title, at: r.at, from: r.from, userIds: [r.user_id] })),
    ];
    if (!targets.length) return;

    const sent = await many<{ kind: string; ref_id: number; user_id: number; minutes_before: number; for_at: Date }>(
      `SELECT kind, ref_id, user_id, minutes_before, for_at FROM reminders_sent
        WHERE (kind = 'task' AND ref_id = ANY ($1)) OR (kind = 'event' AND ref_id = ANY ($2))`,
      [targets.filter((t) => t.kind === 'task').map((t) => t.id), targets.filter((t) => t.kind === 'event').map((t) => t.id)],
      db,
    );
    const done = new Set(sent.map((s) => `${s.kind}:${s.ref_id}:${s.user_id}:${s.minutes_before}:${s.for_at.getTime()}`));

    const now = Date.now();
    for (const t of targets) {
      for (const userId of t.userIds) {
        const mine = (rules.get(userId) ?? []).filter((m) => {
          const trigger = t.at.getTime() - m * 60_000;
          return trigger <= now && trigger >= t.from.getTime() && !done.has(`${t.kind}:${t.id}:${userId}:${m}:${t.at.getTime()}`);
        });
        if (!mine.length) continue;
        const nearest = mine[0];
        const label = reminderLabel(nearest);
        outbox.add({
          userId,
          type: 'task_reminder',
          title: t.kind === 'task' ? `Через ${label} крайний срок: ${t.title}` : `Через ${label} событие: ${t.title}`,
          body: t.kind === 'task' ? `Крайний срок — ${formatDateTimeRu(t.at)}.` : `Начало — ${formatDateTimeRu(t.at)}.`,
          link: t.kind === 'task' ? `/tasks?task=${t.id}` : '/calendar',
        });
        for (const m of mine) {
          await db.query(
            `INSERT INTO reminders_sent (kind, ref_id, user_id, minutes_before, for_at) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (kind, ref_id, user_id, minutes_before) DO UPDATE SET for_at = EXCLUDED.for_at, sent_at = now()`,
            [t.kind, t.id, userId, m, t.at],
          );
        }
      }
    }
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
