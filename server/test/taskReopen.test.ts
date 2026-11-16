import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('возврат закрытой задачи в работу', () => {
  it('итог исполнителя остаётся в цепочке, возврат требует причину и доходит до исполнителя', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const isakov = await loginAs('isakov');
    const created = await semen.post('/api/tasks', { title: 'Подобрать варианты модернизации', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    const id = created.body.id as number;

    expect((await isakov.post('/api/tasks/close', { ids: [id], comment: 'Заказал в Ситилинк, сумма 9620' })).status).toBe(200);
    let task = (await semen.get(`/api/tasks/${id}`)).body;
    expect(task.steps.map((s: any) => s.resultComment)).toEqual(['Заказал в Ситилинк, сумма 9620']);

    // без причины вернуть нельзя
    expect((await semen.post(`/api/tasks/${id}/reopen`, {})).status).toBe(400);
    expect((await semen.post(`/api/tasks/${id}/reopen`, { comment: 'ab' })).status).toBe(400);
    expect((await semen.post(`/api/tasks/${id}/reopen`, { comment: 'Уточни модель памяти' })).status).toBe(200);

    task = (await semen.get(`/api/tasks/${id}`)).body;
    expect(task.status).toBe('open');
    expect(task.steps).toHaveLength(2);
    // итог прежнего шага не пропал, причина возврата записана в новом шаге
    expect(task.steps[0].resultComment).toBe('Заказал в Ситилинк, сумма 9620');
    expect(task.steps[1].comment).toBe('Возвращена в работу: Уточни модель памяти');

    const notes = (await isakov.get('/api/notifications')).body as any;
    const list = (Array.isArray(notes) ? notes : notes.items) as any[];
    const back = list.find((n) => n.type === 'task_reopened' && n.link === `/tasks?task=${id}`);
    expect(back?.body).toContain('Уточни модель памяти');
    await pool.query('SELECT 1');
  });
});
