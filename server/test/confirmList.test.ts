import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

async function overdueTask(assigneeId: number) {
  const semen = await loginAs('semen');
  const r = await semen.post('/api/tasks', { title: 'Просрочена для подтверждения', assigneeId, startAt: new Date().toISOString(), dueAt: inDays(1) });
  await pool.query(`UPDATE tasks SET due_at = now() - interval '1 day' WHERE id = $1`, [r.body.id]);
  return r.body.id as number;
}

describe('«Ждут вашего подтверждения»', () => {
  it('просьба закрыть просроченную задачу попадает в список директора с причиной и уходит после закрытия', async () => {
    const { users } = await dict();
    const id = await overdueTask(users.isakov);
    const stas = await loginAs('isakov');
    expect((await stas.post(`/api/tasks/${id}/close-request`, { comment: 'Диск заменили' })).status).toBe(200);

    const semen = await loginAs('semen');
    const list = (await semen.get('/api/tasks?scope=confirm&status=open')).body as any[];
    const row = list.find((t) => t.id === id);
    expect(row).toMatchObject({ confirmKind: 'close', confirmComment: 'Диск заменили', confirmByName: expect.any(String) });
    // у остальных списка нет
    expect((await stas.get('/api/tasks?scope=confirm&status=open')).body).toEqual([]);

    expect((await semen.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(200);
    expect(((await semen.get('/api/tasks?scope=confirm&status=open')).body as any[]).map((t) => t.id)).not.toContain(id);
  });

  it('просьба продлить срок показывает желаемый срок и снимается, когда директор двигает срок', async () => {
    const { users } = await dict();
    const id = await overdueTask(users.isakov);
    const stas = await loginAs('isakov');
    const want = inDays(5);
    expect((await stas.post(`/api/tasks/${id}/extend-request`, { dueAt: want, comment: 'Ждём запчасть' })).status).toBe(200);
    const semen = await loginAs('semen');
    const row = ((await semen.get('/api/tasks?scope=confirm&status=open')).body as any[]).find((t) => t.id === id);
    expect(row).toMatchObject({ confirmKind: 'extend', confirmComment: 'Ждём запчасть' });
    expect(new Date(row.confirmDue).getTime()).toBe(new Date(want).getTime());

    const cur = (await semen.get(`/api/tasks/${id}`)).body;
    const put = await semen.put(`/api/tasks/${id}`, {
      title: cur.title,
      description: cur.description,
      assigneeIds: cur.assigneeIds,
      watcherIds: cur.watcherIds,
      orderId: cur.orderId,
      clientId: cur.clientId,
      startAt: cur.startAt,
      dueAt: want,
      kindId: cur.kindId,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(((await semen.get('/api/tasks?scope=confirm&status=open')).body as any[]).map((t) => t.id)).not.toContain(id);
  });

  it('о просрочке узнаёт директор, а в уведомлении есть техника, организация и этап', async () => {
    const { users } = await dict();
    const { intakeLaptop } = await import('./helpers');
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 777-10-01');
    const task = (await pool.query(`SELECT id FROM tasks WHERE order_id = $1 AND status = 'open'`, [orderId])).rows[0].id as number;
    await pool.query(`UPDATE tasks SET due_at = now() - interval '1 hour', overdue_notified_at = NULL WHERE id = $1`, [task]);
    const { notifyOverdueTasks } = await import('../src/services/overdue');
    await notifyOverdueTasks();
    const n = (await pool.query(`SELECT user_id, body FROM notifications WHERE type = 'task_overdue' AND link = $1`, [`/tasks?task=${task}`])).rows;
    expect(n.map((r) => r.user_id)).toContain(users.semen);
    expect(n[0].body).toMatch(/Техника:/);
    expect(n[0].body).toMatch(/Организация:/);
    expect(n[0].body).toMatch(/Этап:/);
  });
});
