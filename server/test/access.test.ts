import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

describe('мастер и диагност видят только своё', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('чужая заявка не видна ни в списке, ни по ссылке, ни на главной, ни в карточке клиента', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const forOlga = await intakeLaptop(semen, users.olga, '+7 900 111-00-01');
    const forStas = await intakeLaptop(semen, users.stas, '+7 900 111-00-02');

    const olga = await loginAs('olga');
    const lenya = await loginAs('lenya');

    const olgaList = (await olga.get('/api/orders')).body.items ?? (await olga.get('/api/orders')).body;
    const ids = (olgaList as { id: number }[]).map((o) => o.id);
    expect(ids).toContain(forOlga);
    expect(ids).not.toContain(forStas);

    expect((await olga.get(`/api/orders/${forOlga}`)).status).toBe(200);
    expect((await olga.get(`/api/orders/${forStas}`)).status).toBe(403);
    expect((await lenya.get(`/api/orders/${forOlga}`)).status).toBe(403);

    // руководитель видит все
    const all = (await semen.get('/api/orders')).body;
    const allIds = ((all.items ?? all) as { id: number }[]).map((o) => o.id);
    expect(allIds).toEqual(expect.arrayContaining([forOlga, forStas]));

    const dash = (await lenya.get('/api/dashboard')).body;
    expect(dash.newOrders).toHaveLength(0);

    const stasClient = (await pool.query('SELECT client_id FROM orders WHERE id = $1', [forStas])).rows[0].client_id;
    const card = (await olga.get(`/api/clients/${stasClient}`)).body;
    expect(card.orders).toHaveLength(0);
  });

  it('чужая задача не открывается по ссылке; передавший задачу её видит', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const olga = await loginAs('olga');
    const { users } = await dict();
    const t = await semen.post('/api/tasks', { title: 'Только для Ольги', assigneeId: users.olga, startAt: new Date().toISOString(), dueAt: inDays(1) });
    expect((await olga.get(`/api/tasks/${t.body.id}`)).status).toBe(200);
    expect((await lenya.get(`/api/tasks/${t.body.id}`)).status).toBe(403);
    expect((await semen.get(`/api/tasks/${t.body.id}`)).status).toBe(200);
    // Ольга передаёт Лёне — теперь видят оба
    await olga.post(`/api/tasks/${t.body.id}/transfer`, { assigneeId: users.lenya, dueAt: inDays(2), comment: null });
    expect((await lenya.get(`/api/tasks/${t.body.id}`)).status).toBe(200);
    expect((await olga.get(`/api/tasks/${t.body.id}`)).status).toBe(200);
  });
});
