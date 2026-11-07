import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { notifyOverdueTasks } from '../src/services/overdue';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('статус «Ожидает выдачи»', () => {
  it('задача этапа «Готово» не считается просроченной и не шлёт уведомлений о просрочке', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.semen, '+7 900 000-00-31');
    for (const code of ['approval', 'repair', 'ready']) {
      const r = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage[code], responsibleId: users.semen, dueAt: inDays(1) });
      expect(r.status).toBe(200);
    }
    const taskId = (await pool.query(`SELECT id FROM tasks WHERE order_id = $1 AND status = 'open'`, [id])).rows[0].id as number;
    await pool.query(`UPDATE tasks SET due_at = now() - interval '2 days', was_overdue = true WHERE id = $1`, [taskId]);
    await pool.query(`UPDATE orders SET stage_due_at = now() - interval '2 days' WHERE id = $1`, [id]);

    const task = (await semen.get(`/api/tasks/${taskId}`)).body;
    expect(task.awaitingIssue).toBe(true);
    expect(task.overdue).toBe(false);

    const overdueList = (await semen.get('/api/tasks?scope=all&overdue=1')).body.map((t: any) => t.id);
    expect(overdueList).not.toContain(taskId);
    const awaiting = (await semen.get('/api/tasks?scope=all&awaiting=1')).body.map((t: any) => t.id);
    expect(awaiting).toContain(taskId);
    expect((await semen.get('/api/dashboard')).body.overdue.map((t: any) => t.id)).not.toContain(taskId);
    expect((await semen.get('/api/orders?overdue=1')).body.map((o: any) => o.id)).not.toContain(id);

    await notifyOverdueTasks();
    const notified = await pool.query(`SELECT 1 FROM notifications WHERE type = 'task_overdue' AND link = $1`, [`/tasks?task=${taskId}`]);
    expect(notified.rowCount).toBe(0);
  });
});
