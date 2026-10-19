import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

describe('выезд к клиенту: чек-лист работ', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('список работ клиента сохраняется и читается', async () => {
    const semen = await loginAs('semen');
    const c = await semen.post('/api/clients', { kind: 'legal', name: 'ООО Точка', contactPerson: 'Анна', phone: '+7 900 100-20-30' });
    expect(c.status).toBe(201);
    const put = await semen.put(`/api/clients/${c.body.id}/service-checklist`, {
      items: ['Проверить резервные копии', '', 'Проверить SSD', 'Почистить ПК'],
    });
    expect(put.status).toBe(200);
    const got = await semen.get(`/api/clients/${c.body.id}/service-checklist`);
    expect(got.body.items).toEqual(['Проверить резервные копии', 'Проверить SSD', 'Почистить ПК']);
    // мастер видит, но править не может
    const lenya = await loginAs('lenya');
    expect((await lenya.get(`/api/clients/${c.body.id}/service-checklist`)).status).toBe(200);
    expect((await lenya.put(`/api/clients/${c.body.id}/service-checklist`, { items: [] })).status).toBe(403);
  });

  it('задача-выезд с чек-листом: исполнитель отмечает пункты, посторонний — нет', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const stas = await loginAs('stas');
    const { users } = await dict();
    const clientId = (await pool.query(`SELECT id FROM clients WHERE name = 'ООО Точка'`)).rows[0].id;
    const created = await semen.post('/api/tasks', {
      title: 'Выезд: ООО Точка',
      assigneeId: users.lenya,
      clientId,
      startAt: new Date().toISOString(),
      dueAt: inDays(1),
      checklist: ['Проверить резервные копии', 'Проверить SSD', ' '],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const detail = await lenya.get(`/api/tasks/${id}`);
    expect(detail.body.checklist.map((x: { title: string }) => x.title)).toEqual(['Проверить резервные копии', 'Проверить SSD']);
    const [first] = detail.body.checklist;

    expect((await stas.post(`/api/tasks/${id}/checklist/${first.id}`, { done: true })).status).toBe(403);
    expect((await lenya.post(`/api/tasks/${id}/checklist/${first.id}`, { done: true })).status).toBe(200);
    expect((await lenya.post(`/api/tasks/${id}/checklist/999999`, { done: true })).status).toBe(404);

    const after = await lenya.get(`/api/tasks/${id}`);
    expect(after.body.checklist[0]).toMatchObject({ done: true, doneByName: 'Лёня' });
    expect(after.body).toMatchObject({ checklistTotal: 2, checklistDone: 1 });

    const list = await lenya.get('/api/tasks?scope=mine&status=open');
    expect(list.body.find((t: { id: number }) => t.id === id)).toMatchObject({ checklistTotal: 2, checklistDone: 1 });

    // снять отметку можно
    expect((await lenya.post(`/api/tasks/${id}/checklist/${first.id}`, { done: false })).status).toBe(200);
    expect((await lenya.get(`/api/tasks/${id}`)).body.checklistDone).toBe(0);

    // после закрытия чек-лист не меняется
    await lenya.post('/api/tasks/close', { ids: [id], comment: 'Готово' });
    expect((await lenya.post(`/api/tasks/${id}/checklist/${first.id}`, { done: true })).status).toBe(409);
  });
});
