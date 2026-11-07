import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('уведомления: очистка и состояние задачи', () => {
  it('своё уведомление удаляется, чужое нет; «очистить все» не трогает чужие', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const t = await semen.post('/api/tasks', { title: 'Для уведомления', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    expect(t.status).toBe(201);
    const mine = (await stas.get('/api/notifications')).body.items;
    expect(mine.length).toBeGreaterThan(0);

    // чужое уведомление удалить нельзя: запрос ничего не удаляет
    await semen.del(`/api/notifications/${mine[0].id}`);
    expect((await pool.query('SELECT 1 FROM notifications WHERE id = $1', [mine[0].id])).rowCount).toBe(1);
    expect((await stas.del(`/api/notifications/${mine[0].id}`)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM notifications WHERE id = $1', [mine[0].id])).rowCount).toBe(0);

    const semenBefore = (await pool.query(`SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'semen'`)).rows[0].n;
    await stas.del('/api/notifications');
    expect((await stas.get('/api/notifications')).body.items).toHaveLength(0);
    const semenAfter = (await pool.query(`SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'semen'`)).rows[0].n;
    expect(semenAfter).toBe(semenBefore);
  });

  it('в уведомлении о просрочке видно нынешнее состояние задачи', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const t = await semen.post('/api/tasks', { title: 'Состояние', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    const id = t.body.id as number;
    const link = `/tasks?task=${id}`;
    const find = async () => (await stas.get('/api/notifications')).body.items.find((n: any) => n.link === link);
    expect((await find()).taskState).toBe('open');

    await pool.query(`UPDATE tasks SET due_at = now() - interval '1 day', was_overdue = true WHERE id = $1`, [id]);
    expect((await find()).taskState).toBe('overdue');

    expect((await semen.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(200);
    const closed = await find();
    expect(closed.taskState).toBe('closed');
  });
});
