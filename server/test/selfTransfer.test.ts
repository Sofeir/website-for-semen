import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

async function task(assigneeId: number) {
  const semen = await loginAs('semen');
  const r = await semen.post('/api/tasks', { title: 'Себе', assigneeId, startAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3_600_000).toISOString() });
  expect(r.status).toBe(201);
  return r.body.id as number;
}

describe('передача задачи самому себе', () => {
  it('до просрочки исполнитель передаёт себе и двигает срок без подтверждения, шаг остаётся в цепочке', async () => {
    const { users } = await dict();
    const id = await task(users.isakov);
    const stas = await loginAs('isakov');
    const later = inDays(3);
    const r = await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.isakov, dueAt: later, comment: 'Не успеваю, переношу' });
    expect(r.status).toBe(200);
    expect(r.body.requested).toBe(false);
    const t = (await stas.get(`/api/tasks/${id}`)).body;
    expect(new Date(t.dueAt).getTime()).toBe(new Date(later).getTime());
    const steps = (await pool.query('SELECT assignee_id, from_user_id, comment FROM task_steps WHERE task_id = $1 AND done_at IS NULL', [id])).rows;
    expect(steps).toEqual([{ assignee_id: users.isakov, from_user_id: users.isakov, comment: 'Не успеваю, переношу' }]);
  });

  it('другому можно передать со сдвигом срока, пока она не просрочена; просроченной срок двигает директор; тому, у кого она уже есть, передать нельзя', async () => {
    const { users } = await dict();
    const id = await task(users.isakov);
    const stas = await loginAs('isakov');
    const semen = await loginAs('semen');
    expect((await semen.post(`/api/tasks/${id}/transfer`, { assigneeId: users.isakov, dueAt: inDays(3), comment: 'Станиславу' })).status).toBe(400);
    expect((await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(3), comment: 'Артёму' })).status).toBe(200);
    const late = await task(users.isakov);
    await pool.query(`UPDATE tasks SET due_at = now() - interval '1 hour', start_at = now() - interval '2 hours' WHERE id = $1`, [late]);
    expect((await stas.post(`/api/tasks/${late}/transfer`, { assigneeId: users.kataev, dueAt: inDays(3), comment: 'Артёму' })).status).toBe(403);
  });

  it('у просроченной задачи срок себе двигает только директор, остальные отправляют запрос', async () => {
    const { users } = await dict();
    const id = await task(users.isakov);
    await pool.query(`UPDATE tasks SET due_at = now() - interval '1 day' WHERE id = $1`, [id]);
    const stas = await loginAs('isakov');
    const before = (await stas.get(`/api/tasks/${id}`)).body.dueAt;
    const r = await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.isakov, dueAt: inDays(3), comment: 'Ждал запчасть' });
    expect(r.status).toBe(200);
    expect(r.body.requested).toBe(true);
    expect((await stas.get(`/api/tasks/${id}`)).body.dueAt).toBe(before);
    const asked = await pool.query(
      `SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'semen' AND n.type = 'task_extend_request' AND n.title LIKE '%Себе%'`,
    );
    expect(asked.rowCount).toBe(1);

    const semen = await loginAs('semen');
    const own = await semen.post(`/api/tasks/${id}/transfer`, { assigneeId: users.semen, dueAt: inDays(3), comment: 'Беру на себя' });
    expect(own.status).toBe(200);
    expect(own.body.requested).toBe(false);
  });
});
