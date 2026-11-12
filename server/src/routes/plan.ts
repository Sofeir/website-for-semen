import { Router } from 'express';
import { can } from '@sd/shared';
import { many, one, pool, tx } from '../db/pool';
import { h, HttpError, intParam } from '../lib/http';
import { requirePermission } from '../auth/session';
import { Outbox } from '../notify/notify';
import { getWorkSettings } from '../services/settings';
import { assertActiveUser, createTask } from '../services/tasks';
import { deleteTasksForever } from '../services/testDataCleanup';
import { endOfWorkDay } from '../services/workTime';

/**
 * План месяца: у каждого сотрудника закреплены организации (у одной организации может быть несколько сотрудников),
 * в начале месяца он расставляет даты выезда или удалённого подключения, и они сразу попадают в календарь как задачи-выезды.
 */
export const planRouter = Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
/** Метка в описании: по ней видно, что выезд поставлен в плане месяца (и только такие выезды план может убрать). */
export const PLAN_MARK = 'Запланировано в плане месяца.';
const MODE_PREFIX = { onsite: 'Выезд: ', remote: 'Удалённое обслуживание: ' } as const;

/** Чей план смотрим и правим: свой; чужой — руководитель. */
function targetUser(req: { user?: { id: number; role: Parameters<typeof can>[0] } }, raw: unknown, perm: 'tasks.manageAll' | 'clients.edit') {
  const me = req.user!;
  const wanted = raw === undefined || raw === null || raw === '' ? me.id : Number(raw);
  if (!Number.isInteger(wanted) || wanted <= 0) throw new HttpError(400, 'Выберите сотрудника из списка');
  if (wanted !== me.id && !can(me.role, perm)) throw new HttpError(403, 'Чужой план правит руководитель');
  return wanted;
}

planRouter.get(
  '/plan',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const month = String(req.query.month ?? '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Укажите месяц');
    const [y, m] = month.split('-').map(Number);
    const from = new Date(y!, m! - 1, 1);
    const to = new Date(y!, m!, 1);
    const userId = targetUser(req, req.query.user, 'tasks.manageAll');
    const user = await one<{ id: number; full_name: string }>('SELECT id, full_name FROM users WHERE id = $1 AND is_active', [userId]);
    if (!user) throw new HttpError(404, 'Сотрудник не найден');

    const visits = await many<{ id: number; clientId: number; clientName: string; title: string; dueAt: Date; mode: 'onsite' | 'remote'; status: string; closedAt: Date | null }>(
      `SELECT t.id, t.client_id AS "clientId", c.name AS "clientName", t.title, t.due_at AS "dueAt", t.visit_mode AS mode, t.status, t.closed_at AS "closedAt"
         FROM tasks t JOIN clients c ON c.id = t.client_id
        WHERE t.is_visit AND t.due_at >= $2 AND t.due_at < $3
          AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
        ORDER BY t.due_at`,
      [userId, from, to],
    );
    const assigned = await many<{ id: number; name: string; others: string[] }>(
      `SELECT c.id, c.name,
              ARRAY(SELECT u.full_name FROM client_staff s2 JOIN users u ON u.id = s2.user_id WHERE s2.client_id = c.id AND s2.user_id <> $1 ORDER BY u.full_name) AS others
         FROM client_staff s JOIN clients c ON c.id = s.client_id WHERE s.user_id = $1 ORDER BY lower(c.name)`,
      [userId],
    );
    const rows = new Map<number, { id: number; name: string; assigned: boolean; others: string[]; visits: typeof visits }>();
    for (const a of assigned) rows.set(a.id, { id: a.id, name: a.name, assigned: true, others: a.others, visits: [] });
    // Организации, к которым в этом месяце уже есть выезд, но они не закреплены: не прячем
    for (const v of visits) {
      if (!rows.has(v.clientId)) rows.set(v.clientId, { id: v.clientId, name: v.clientName, assigned: false, others: [], visits: [] });
      rows.get(v.clientId)!.visits.push(v);
    }
    res.json({ userId: user.id, userName: user.full_name, month, clients: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')) });
  }),
);

/** Закрепить организацию за сотрудником или снять закрепление. Себе — любой сотрудник, другому — руководитель. */
planRouter.put(
  '/plan/clients',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const userId = targetUser(req, req.body?.userId, 'clients.edit');
    const clientId = Number(req.body?.clientId);
    if (!Number.isInteger(clientId) || clientId <= 0) throw new HttpError(400, 'Выберите организацию');
    await assertActiveUser(pool, userId);
    if (!(await one('SELECT 1 FROM clients WHERE id = $1', [clientId]))) throw new HttpError(404, 'Клиент не найден');
    if (req.body?.assigned === false) await pool.query('DELETE FROM client_staff WHERE client_id = $1 AND user_id = $2', [clientId, userId]);
    else await pool.query('INSERT INTO client_staff (client_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [clientId, userId]);
    res.json({ ok: true });
  }),
);

/** Даты выездов или удалённого обслуживания на месяц: каждая — задача-выезд, сразу видна в календаре. Уже стоящая на тот же день пропускается. */
planRouter.post(
  '/plan/visits',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const userId = targetUser(req, req.body?.userId, 'tasks.manageAll');
    const clientId = Number(req.body?.clientId);
    const items: { date: string; mode: 'onsite' | 'remote' }[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isInteger(clientId) || clientId <= 0) throw new HttpError(400, 'Выберите организацию');
    if (!items.length || items.length > 40) throw new HttpError(400, 'Выберите от одной до сорока дат');
    for (const it of items) {
      if (!YMD.test(String(it?.date)) || Number.isNaN(parseYmd(it.date).getTime())) throw new HttpError(400, 'Дата указана неверно');
      if (it.mode !== 'onsite' && it.mode !== 'remote') throw new HttpError(400, 'Укажите: выезд или удалённо');
    }
    const client = await one<{ name: string }>('SELECT name FROM clients WHERE id = $1', [clientId]);
    if (!client) throw new HttpError(404, 'Клиент не найден');
    await assertActiveUser(pool, userId);
    const outbox = new Outbox();
    const result = await tx(async (db) => {
      const ws = await getWorkSettings(db);
      const created: number[] = [];
      let skipped = 0;
      // организация закрепляется за сотрудником, когда он ставит на неё даты
      await db.query('INSERT INTO client_staff (client_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [clientId, userId]);
      for (const it of items) {
        const day = parseYmd(it.date);
        const dup = await one(
          `SELECT 1 FROM tasks t
            WHERE t.is_visit AND t.status = 'open' AND t.client_id = $1 AND t.visit_mode = $2
              AND t.due_at >= $3 AND t.due_at < $3::timestamptz + interval '1 day'
              AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $4)`,
          [clientId, it.mode, new Date(day.getFullYear(), day.getMonth(), day.getDate()), userId],
          db,
        );
        if (dup) {
          skipped++;
          continue;
        }
        const [h0, m0] = ws.workStart.split(':').map(Number);
        const start = new Date(day);
        start.setHours(h0 || 0, m0 || 0, 0, 0);
        created.push(
          await createTask(
            db,
            req.user!,
            {
              title: `${MODE_PREFIX[it.mode]}${client.name}`,
              description: PLAN_MARK,
              assigneeId: userId,
              clientId,
              orderId: null,
              startAt: start.toISOString(),
              dueAt: endOfWorkDay(day, ws).toISOString(),
              visit: true,
              visitMode: it.mode,
            },
            outbox,
          ),
        );
      }
      return { created, skipped };
    });
    await outbox.flush();
    res.status(201).json(result);
  }),
);

/**
 * Убрать запланированный, но ещё не начатый выезд. Только то, что поставили через план месяца (по метке в описании), без заявки и этапа,
 * не просроченное (просроченное убирает руководитель) и без отметок о проверке. Удаляет тот, кто поставил, или руководитель.
 */
planRouter.delete(
  '/plan/visits/:id',
  requirePermission('workspace.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const t = await one<{ creator_id: number; status: string; due_at: Date }>(
      `SELECT t.creator_id, t.status, t.due_at FROM tasks t
        WHERE t.id = $1 AND t.is_visit AND t.description = $2 AND t.order_id IS NULL AND t.stage_id IS NULL`,
      [id, PLAN_MARK],
    );
    if (!t) throw new HttpError(404, 'Такого выезда в плане нет: убрать можно только то, что поставлено в плане месяца');
    const me = req.user!;
    const manager = can(me.role, 'tasks.manageAll');
    if (!(t.creator_id === me.id || manager)) throw new HttpError(403, 'Убрать выезд из плана может тот, кто его поставил, или руководитель');
    if (t.status !== 'open') throw new HttpError(409, 'Выезд уже проведён: его не убрать');
    if (t.due_at.getTime() < Date.now() && !manager) throw new HttpError(403, 'Дата выезда прошла: убрать его может руководитель');
    const worked = await one(
      `SELECT 1 FROM device_inspections WHERE task_id = $1 UNION ALL SELECT 1 FROM task_checklist_items WHERE task_id = $1 AND done LIMIT 1`,
      [id],
    );
    if (worked) throw new HttpError(409, 'По этому выезду уже есть отметки о проверке: убрать его нельзя, закройте его');
    await deleteTasksForever([id]);
    res.json({ ok: true });
  }),
);
