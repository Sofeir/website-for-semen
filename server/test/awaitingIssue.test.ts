import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { notifyOverdueTasks } from '../src/services/overdue';
import { dict, inDays, intakeLaptop, loginAs, resetDb, satisfyStageChecks } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('статус «Ожидает выдачи»', () => {
  it('задача «Выдать» получает месяц на выдачу', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.semen, '+7 900 000-00-30');
    await satisfyStageChecks(id);
    for (const code of ['approval', 'repair']) {
      expect((await semen.post(`/api/orders/${id}/advance`, { toStageId: stage[code], responsibleId: users.semen, dueAt: inDays(1) })).status).toBe(200);
    }
    // срок не назван: подставляется месяц
    expect((await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.ready, responsibleId: users.semen })).status).toBe(200);
    const due = new Date((await pool.query(`SELECT due_at FROM tasks WHERE order_id = $1 AND status = 'open'`, [id])).rows[0].due_at as string).getTime();
    const days = (due - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(26);
    expect(days).toBeLessThan(32);
  });

  it('пока месяц не вышел, задача этапа «Готово» не считается просроченной; когда вышел, просрочка уходит директору', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.semen, '+7 900 000-00-31');
    await satisfyStageChecks(id);
    for (const code of ['approval', 'repair', 'ready']) {
      const r = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage[code], responsibleId: users.semen, dueAt: inDays(1) });
      expect(r.status).toBe(200);
    }
    const taskId = (await pool.query(`SELECT id FROM tasks WHERE order_id = $1 AND status = 'open'`, [id])).rows[0].id as number;
    await pool.query(`UPDATE tasks SET due_at = now() + interval '10 days', was_overdue = true WHERE id = $1`, [taskId]);
    await pool.query(`UPDATE orders SET stage_due_at = now() + interval '10 days' WHERE id = $1`, [id]);

    const task = (await semen.get(`/api/tasks/${taskId}`)).body;
    expect(task.awaitingIssue).toBe(true);
    expect(task.overdue).toBe(false);

    const overdueList = (await semen.get('/api/tasks?scope=all&overdue=1')).body.map((t: any) => t.id);
    expect(overdueList).not.toContain(taskId);
    const awaiting = (await semen.get('/api/tasks?scope=all&awaiting=1')).body.map((t: any) => t.id);
    expect(awaiting).toContain(taskId);
    expect((await semen.get('/api/dashboard')).body.overdue.map((t: any) => t.id)).not.toContain(taskId);
    expect((await semen.get('/api/orders?overdue=1')).body.map((o: any) => o.id)).not.toContain(id);

    // страница «Готовая техника»: заявка этапа «Готово» отдаётся с итогом ремонта
    const ready = (await semen.get(`/api/orders?stage=${stage.ready}`)).body.find((o: any) => o.id === id);
    expect(ready).toMatchObject({ deviceType: 'Ноутбук', outcome: 'repaired' });

    await notifyOverdueTasks();
    const notified = await pool.query(`SELECT 1 FROM notifications WHERE type = 'task_overdue' AND link = $1`, [`/tasks?task=${taskId}`]);
    expect(notified.rowCount).toBe(0);

    // месяц вышел: обычная просрочка, о ней узнаёт директор (тот, кто подтверждает просрочку)
    await pool.query(`UPDATE tasks SET due_at = now() - interval '1 day', overdue_notified_at = NULL WHERE id = $1`, [taskId]);
    await pool.query(`UPDATE orders SET stage_due_at = now() - interval '1 day' WHERE id = $1`, [id]);
    expect((await semen.get(`/api/tasks/${taskId}`)).body.overdue).toBe(true);
    await notifyOverdueTasks();
    const directors = (await pool.query(`SELECT id FROM users WHERE confirms_overdue AND is_active`)).rows.map((r) => r.id as number);
    expect(directors.length).toBeGreaterThan(0);
    const got = (await pool.query(`SELECT user_id FROM notifications WHERE type = 'task_overdue' AND link = $1`, [`/tasks?task=${taskId}`])).rows.map((r) => r.user_id as number);
    for (const d of directors) expect(got).toContain(d);
  });
});
