import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('план месяца', () => {
  it('сотрудник закрепляет организацию, ставит даты выезда и удалённого, они сразу попадают в задачи и календарь', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const clientId = (await semen.post('/api/clients', { kind: 'legal', name: 'Школяр ООО', phone: '+7 343 100-00-00', inn: '6600000123', kpp: null, email: '', address: null, contactPerson: null, note: null, phone2: null })).body.id as number;
    const stas = await loginAs('isakov');
    const next = new Date();
    next.setDate(next.getDate() + 3);
    const later = new Date();
    later.setDate(later.getDate() + 5);
    const month = ymd(next).slice(0, 7);

    expect((await stas.put('/api/plan/clients', { clientId, assigned: true })).status).toBe(200);
    const made = await stas.post('/api/plan/visits', {
      clientId,
      items: [
        { date: ymd(next), mode: 'onsite' },
        { date: ymd(later), mode: 'remote' },
      ],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.created).toHaveLength(2);
    expect(made.body.skipped).toBe(0);

    const rows = (await pool.query(`SELECT title, visit_mode, is_visit, assignee_id FROM tasks WHERE id = ANY ($1) ORDER BY id`, [made.body.created])).rows;
    expect(rows.map((r) => r.visit_mode)).toEqual(['onsite', 'remote']);
    expect(rows[0]).toMatchObject({ title: 'Выезд: Школяр ООО', is_visit: true, assignee_id: users.isakov });
    expect(rows[1].title).toBe('Удалённое обслуживание: Школяр ООО');

    // та же дата и режим второй раз не ставится
    const again = await stas.post('/api/plan/visits', { clientId, items: [{ date: ymd(next), mode: 'onsite' }] });
    expect(again.body).toMatchObject({ created: [], skipped: 1 });

    const plan = (await stas.get(`/api/plan?month=${month}`)).body;
    const row = plan.clients.find((c: any) => c.id === clientId);
    expect(row.assigned).toBe(true);
    expect(row.visits.length).toBeGreaterThanOrEqual(1);

    // они в календаре сотрудника (список задач за период)
    const tasks = (await stas.get(`/api/tasks?scope=mine&status=open`)).body.map((t: any) => t.id);
    for (const id of made.body.created) expect(tasks).toContain(id);

    // убрать ещё не начатый выезд
    expect((await stas.del(`/api/plan/visits/${made.body.created[1]}`)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM tasks WHERE id = $1', [made.body.created[1]])).rowCount).toBe(0);

    // чужие выезды (не из плана) и выезды, поставленные другим, через план не удаляются
    const foreign = (await semen.post('/api/tasks', { title: 'Выезд: Школяр ООО', assigneeId: users.isakov, clientId, visit: true, startAt: new Date().toISOString(), dueAt: new Date(Date.now() + 86_400_000).toISOString() })).body.id as number;
    expect((await stas.del(`/api/plan/visits/${foreign}`)).status).toBe(404);
    const byBoss = await semen.post('/api/plan/visits', { clientId, userId: users.isakov, items: [{ date: ymd(later), mode: 'onsite' }] });
    expect((await stas.del(`/api/plan/visits/${byBoss.body.created[0]}`)).status).toBe(403);
    expect((await semen.del(`/api/plan/visits/${byBoss.body.created[0]}`)).status).toBe(200);
  });

  it('несколько сотрудников на одной организации; чужой план правит только руководитель', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const clientId = (await semen.post('/api/clients', { kind: 'legal', name: 'ЮРАЛ ТРЭЙД', phone: '+7 343 200-00-00', inn: '6600000456', kpp: null, email: '', address: null, contactPerson: null, note: null, phone2: null })).body.id as number;
    const stas = await loginAs('isakov');
    const artem = await loginAs('kataev');
    await stas.put('/api/plan/clients', { clientId, assigned: true });
    await artem.put('/api/plan/clients', { clientId, assigned: true });
    const now = new Date();
    const month = ymd(now).slice(0, 7);
    const mine = (await artem.get(`/api/plan?month=${month}`)).body.clients.find((c: any) => c.id === clientId);
    expect(mine.others).toHaveLength(1);

    // обычный сотрудник чужим планом не распоряжается
    expect((await artem.put('/api/plan/clients', { clientId, userId: users.isakov, assigned: false })).status).toBe(403);
    expect((await artem.get(`/api/plan?month=${month}&user=${users.isakov}`)).status).toBe(403);
    expect((await artem.post('/api/plan/visits', { clientId, userId: users.isakov, items: [{ date: ymd(now), mode: 'onsite' }] })).status).toBe(403);
    // руководитель закрепляет за сотрудником
    expect((await semen.put('/api/plan/clients', { clientId, userId: users.isakov, assigned: false })).status).toBe(200);
    const left = (await pool.query('SELECT user_id FROM client_staff WHERE client_id = $1', [clientId])).rows.map((r) => r.user_id);
    expect(left).toEqual([users.kataev]);
    const forStas = await semen.post('/api/plan/visits', { clientId, userId: users.isakov, items: [{ date: ymd(now), mode: 'remote' }] });
    expect(forStas.status).toBe(201);

    // неверная дата и пустой список
    expect((await stas.post('/api/plan/visits', { clientId, items: [{ date: '31.12.2026', mode: 'onsite' }] })).status).toBe(400);
    expect((await stas.post('/api/plan/visits', { clientId, items: [] })).status).toBe(400);
  });
});
