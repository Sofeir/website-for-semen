import type { ServicePlan } from '@sd/shared';
import { many, pool, tx } from '../db/pool';
import { Outbox } from '../notify/notify';
import { getWorkSettings } from './settings';
import { createTask, type Actor } from './tasks';
import { endOfWorkDay } from './workTime';

export const SERVICE_PLAN_SELECT = `
  SELECT p.id, p.client_id AS "clientId", c.name AS "clientName", p.every_n AS "everyN", p.unit,
         p.next_date::text AS "nextDate", p.visit_time AS "visitTime", p.assignee_id AS "assigneeId",
         u.full_name AS "assigneeName", p.is_active AS "isActive", p.last_task_id AS "lastTaskId"
    FROM service_plans p
    JOIN clients c ON c.id = p.client_id
    JOIN users u ON u.id = p.assignee_id`;

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Следующая дата по графику. Месяц считается от исходного числа: 31 января + 1 месяц = 28/29 февраля. */
export function nextVisitDate(from: string, everyN: number, unit: 'week' | 'month'): string {
  const d = parseYmd(from);
  if (unit === 'week') {
    d.setDate(d.getDate() + everyN * 7);
    return ymd(d);
  }
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + everyN, 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return ymd(r);
}

/**
 * Ставит задачи по графикам, у которых выезд сегодня или завтра (задача приходит заранее, накануне).
 * Если сервер долго не работал и даты прошли, ставится одна задача на сегодня, а график сдвигается вперёд.
 */
export async function runServicePlans(now = new Date()): Promise<number> {
  const today = ymd(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = ymd(tomorrowDate);
  const due = await many<{ id: number }>(
    `SELECT id FROM service_plans WHERE is_active AND next_date <= $1::date ORDER BY next_date`,
    [tomorrow],
  );
  let created = 0;
  for (const { id } of due) {
    const outbox = new Outbox();
    const made = await tx(async (db) => {
      const p = (
        await db.query(
          `SELECT p.*, p.next_date::text AS next_ymd, c.name AS client_name
             FROM service_plans p JOIN clients c ON c.id = p.client_id
            WHERE p.id = $1 AND p.is_active AND p.next_date <= $2::date
            FOR UPDATE OF p SKIP LOCKED`,
          [id, tomorrow],
        )
      ).rows[0];
      if (!p) return false;
      const day = p.next_ymd < today ? today : (p.next_ymd as string);
      let next = p.next_ymd as string;
      while (next <= day) next = nextVisitDate(next, p.every_n, p.unit);

      const creator = (
        await db.query(`SELECT id, role, full_name AS "fullName" FROM users WHERE id = $1`, [p.created_by ?? p.assignee_id])
      ).rows[0] as Actor;
      const assignee = (await db.query(`SELECT is_active FROM users WHERE id = $1`, [p.assignee_id])).rows[0];
      let taskId: number | null = null;
      if (assignee?.is_active) {
        const ws = await getWorkSettings(db);
        const start = parseYmd(day);
        const [h, m] = String(p.visit_time || ws.workStart)
          .split(':')
          .map(Number);
        start.setHours(h || 0, m || 0, 0, 0);
        taskId = await createTask(
          db,
          creator,
          {
            title: `Выезд: ${p.client_name}`,
            description: 'Плановый выезд по графику.',
            assigneeId: p.assignee_id,
            clientId: p.client_id,
            orderId: null,
            startAt: start.toISOString(),
            dueAt: endOfWorkDay(parseYmd(day), ws).toISOString(),
            visit: true,
          },
          outbox,
        );
      }
      await db.query(
        `UPDATE service_plans SET next_date = $2::date, last_task_id = COALESCE($3, last_task_id), updated_at = now() WHERE id = $1`,
        [id, next, taskId],
      );
      outbox.touch('clients');
      return taskId !== null;
    });
    await outbox.flush();
    if (made) created += 1;
  }
  return created;
}

let lastRun = 0;
let running: Promise<unknown> | null = null;

/** Запускает проверку графиков не чаще раза в минуту — её дёргают «Сегодня» и список задач. */
export function runServicePlansSoon() {
  if (running || Date.now() - lastRun < 60_000) return running ?? Promise.resolve();
  lastRun = Date.now();
  running = runServicePlans()
    .catch((e) => console.error('График выездов:', e.message))
    .finally(() => {
      running = null;
    });
  return running;
}

export async function getServicePlan(clientId: number): Promise<ServicePlan | null> {
  const rows = await many<ServicePlan>(`${SERVICE_PLAN_SELECT} WHERE p.client_id = $1`, [clientId], pool);
  return rows[0] ?? null;
}
