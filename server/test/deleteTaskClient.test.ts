import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('удаление задач и клиентов без доступа к серверу', () => {
  it('закрытую задачу удаляет директор навсегда, открытую и чужим сотрудникам нельзя', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const t = await semen.post('/api/tasks', { title: 'Удалить меня', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    const id = t.body.id as number;
    // открытая задача не удаляется
    expect((await semen.del(`/api/tasks/${id}`)).status).toBe(409);
    expect((await stas.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(200);
    // исполнитель без права управлять всеми задачами не удаляет
    expect((await stas.del(`/api/tasks/${id}`)).status).toBe(403);
    expect((await pool.query('SELECT 1 FROM tasks WHERE id = $1', [id])).rowCount).toBe(1);
    expect((await semen.del(`/api/tasks/${id}`)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM tasks WHERE id = $1', [id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM task_steps WHERE task_id = $1', [id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM notifications WHERE link = $1', [`/tasks?task=${id}`])).rowCount).toBe(0);
    expect((await semen.del(`/api/tasks/${id}`)).status).toBe(404);
  });

  it('клиента без заявок удаляет директор, клиента с заявками нельзя', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const withOrder = await intakeLaptop(semen, users.isakov, '+7 900 000-00-41');
    const clientWithOrder = (await pool.query('SELECT client_id FROM orders WHERE id = $1', [withOrder])).rows[0].client_id as number;
    const denied = await semen.del(`/api/clients/${clientWithOrder}`);
    expect(denied.status).toBe(409);
    expect(denied.body.error).toMatch(/заявки/);

    const created = await semen.post('/api/clients', { kind: 'legal', name: 'ООО Лишний', inn: '6600000099' });
    expect(created.status).toBe(201);
    const stas = await loginAs('isakov');
    expect((await stas.del(`/api/clients/${created.body.id}`)).status).toBe(403);
    expect((await semen.del(`/api/clients/${created.body.id}`)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM clients WHERE id = $1', [created.body.id])).rowCount).toBe(0);
    expect((await semen.del(`/api/clients/${created.body.id}`)).status).toBe(404);
  });
});
