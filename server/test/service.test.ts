import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { nextVisitDate, runServicePlans, ymd } from '../src/services/servicePlans';
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

  it('график выездов: даты считаются верно', () => {
    expect(nextVisitDate('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(nextVisitDate('2026-10-19', 2, 'week')).toBe('2026-11-02');
    expect(nextVisitDate('2026-11-30', 3, 'month')).toBe('2027-02-28');
  });

  it('график выездов: накануне ставится задача с чек-листом, дата сдвигается, повторно не дублируется', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const { users } = await dict();
    const clientId = (await pool.query(`SELECT id FROM clients WHERE name = 'ООО Точка'`)).rows[0].id;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const plan = { everyN: 2, unit: 'week', nextDate: ymd(tomorrow), visitTime: '11:30', assigneeId: users.lenya, isActive: true };
    expect((await lenya.put(`/api/clients/${clientId}/service-plan`, plan)).status).toBe(403);
    const put = await semen.put(`/api/clients/${clientId}/service-plan`, plan);
    expect(put.status).toBe(200);
    // выезд завтра — задача уже поставлена, следующий выезд через 2 недели
    expect(put.body.plan.nextDate).toBe(nextVisitDate(ymd(tomorrow), 2, 'week'));
    const taskId = put.body.plan.lastTaskId;
    expect(taskId).toBeTruthy();
    const task = await lenya.get(`/api/tasks/${taskId}`);
    expect(task.body.title).toBe('Выезд: ООО Точка');
    expect(task.body.checklist.map((x: { title: string }) => x.title)).toEqual([
      'Проверить резервные копии',
      'Проверить SSD',
      'Почистить ПК',
    ]);
    expect(new Date(task.body.startAt).getHours()).toBe(11);
    expect(await runServicePlans()).toBe(0);
    const list = await semen.get('/api/visits');
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0].assigneeName).toBe('Лёня');
  });

  it('раздел «Выезды»: руководитель видит все, исполнитель — свои, посторонний — ничего', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const stas = await loginAs('stas');
    const all = (await semen.get('/api/visits')).body;
    expect(all.tasks.length).toBeGreaterThan(0);
    expect(all.tasks.every((t: { isVisit: boolean }) => t.isVisit)).toBe(true);
    expect(all.plans[0].upcoming).toHaveLength(3);
    const mine = (await lenya.get('/api/visits')).body;
    expect(mine.plans).toHaveLength(1);
    expect(mine.tasks.length).toBeGreaterThan(0);
    const other = (await stas.get('/api/visits')).body;
    expect(other.plans).toHaveLength(0);
    expect(other.tasks).toHaveLength(0);
  });
});
