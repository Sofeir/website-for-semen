import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

async function client(name: string) {
  return (await pool.query(`INSERT INTO clients (kind, name) VALUES ('legal', $1) RETURNING id`, [name])).rows[0].id as number;
}

describe('закупки', () => {
  it('цепочка: заявка, согласование, куплено, отвёз; покупает тот, кто завёл заявку', async () => {
    const { users } = await dict();
    const globus = await client('Глобус');
    const stas = await loginAs('isakov');
    const semen = await loginAs('semen');
    const r = await stas.post('/api/purchases', { title: 'Новая мышка', clientId: globus });
    expect(r.status).toBe(201);
    const id = r.body.id as number;

    let p = (await stas.get(`/api/purchases/${id}`)).body;
    expect(p.status).toBe('approval');
    expect(p.buyerId).toBe(users.isakov);
    expect(p.canApprove).toBe(false);
    // Директор получил просьбу согласовать
    const note = await pool.query(`SELECT title, link FROM notifications WHERE user_id = $1 AND type = 'purchase_approval'`, [users.semen]);
    expect(note.rows[0].link).toBe(`/purchases?open=${id}`);

    // Покупать до согласования нельзя, согласовать может только директор
    expect((await stas.post(`/api/purchases/${id}/bought`)).status).toBe(409);
    expect((await stas.post(`/api/purchases/${id}/approve`)).status).toBe(403);
    expect((await semen.post(`/api/purchases/${id}/approve`, {})).status).toBe(200);
    expect((await semen.post(`/api/purchases/${id}/approve`, {})).status).toBe(409);

    p = (await stas.get(`/api/purchases/${id}`)).body;
    expect(p.status).toBe('buying');
    expect(p.canAdvance).toBe(true);
    expect((await stas.post(`/api/purchases/${id}/bought`, { comment: '' })).status).toBe(200);
    expect((await stas.post(`/api/purchases/${id}/delivered`)).status).toBe(200);
    p = (await stas.get(`/api/purchases/${id}`)).body;
    expect(p.status).toBe('done');
    expect(p.events.map((e: { action: string }) => e.action)).toEqual(['created', 'approved', 'bought', 'delivered']);
  });

  it('отказ закрывает заявку без причины; директор может назначить другого покупателя', async () => {
    const { users } = await dict();
    const stas = await loginAs('isakov');
    const semen = await loginAs('semen');
    const a = (await stas.post('/api/purchases', { title: 'Монитор' })).body.id;
    expect((await semen.post(`/api/purchases/${a}/reject`, {})).status).toBe(200);
    expect((await stas.get(`/api/purchases/${a}`)).body.status).toBe('rejected');
    expect((await stas.post(`/api/purchases/${a}/cancel`)).status).toBe(409);

    const b = (await stas.post('/api/purchases', { title: 'Кабель' })).body.id;
    expect((await semen.post(`/api/purchases/${b}/approve`, { buyerId: users.kataev })).status).toBe(200);
    const kataev = await loginAs('kataev');
    expect((await kataev.get(`/api/purchases/${b}`)).body.canAdvance).toBe(true);
    expect((await stas.post(`/api/purchases/${b}/bought`)).status).toBe(403);
    expect((await kataev.post(`/api/purchases/${b}/bought`)).status).toBe(200);
  });

  it('чужие закупки не видны; создатель отменяет свою; поиск клиента по буквам', async () => {
    const stas = await loginAs('isakov');
    const kataev = await loginAs('kataev');
    const id = (await stas.post('/api/purchases', { title: 'Флешка' })).body.id;
    expect((await kataev.get(`/api/purchases/${id}`)).status).toBe(403);
    expect((await kataev.get('/api/purchases')).body.some((x: { id: number }) => x.id === id)).toBe(false);
    expect((await stas.get('/api/purchases?scope=mine')).body.some((x: { id: number }) => x.id === id)).toBe(true);
    expect((await stas.post(`/api/purchases/${id}/cancel`)).status).toBe(200);
    expect((await stas.get(`/api/purchases/${id}`)).body.status).toBe('cancelled');

    await client('Глобус Плюс');
    const hits = (await kataev.get('/api/purchases/clients?q=глоб')).body;
    expect(hits.length).toBeGreaterThan(0);
    expect((await kataev.get('/api/purchases/clients?q=г')).body).toEqual([]);
  });

  it('без названия заявка не создаётся', async () => {
    const stas = await loginAs('isakov');
    expect((await stas.post('/api/purchases', { title: '' })).status).toBe(400);
    expect((await stas.post('/api/purchases', { title: 'Мышка', buyerId: 999999 })).status).toBe(400);
  });
});
