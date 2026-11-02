import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('приём картриджа', () => {
  it('создаёт заявку и задачу на диагностику, как для любой техники', async () => {
    const { users } = await dict();
    const typeId = (await pool.query(`SELECT id FROM device_types WHERE name = 'Картридж'`)).rows[0].id as number;
    const hp = (await pool.query(`SELECT id FROM brands WHERE name = 'HP' AND device_type_id = $1`, [typeId])).rows[0];
    const s = await loginAs('semen');
    const res = await s.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Клиент с картриджем', phone: '+7 900 555-00-01' },
      devices: [
        {
          device: { deviceTypeId: typeId, brandId: hp?.id ?? null, brandText: hp ? null : 'HP', modelText: '85A' },
          faultText: 'Нужна заправка',
        },
      ],
      responsibleId: users.isakov,
      dueAt: inDays(1),
    });
    expect(res.status).toBe(201);
    expect(res.body.orderIds).toHaveLength(1);
    const order = (await pool.query('SELECT id, device_id FROM orders WHERE id = $1', [res.body.orderIds[0]])).rows[0];
    expect(order).toBeDefined();
    const tasks = (await pool.query('SELECT 1 FROM tasks WHERE order_id = $1', [order.id])).rowCount;
    expect(tasks).toBeGreaterThan(0);
  });
});

describe('заправка картриджей по клиенту', () => {
  const refill = (clientId: number, extra: object, performerId: number) => ({
    clientId,
    kind: 'refill',
    title: 'CF259A',
    qty: 3,
    performerId,
    ops: ['refill'],
    ...extra,
  });

  it('с newOrder заводит заявку и задачу, запись привязана к заявке', async () => {
    const { users } = await dict();
    const clientId = (await pool.query(`SELECT id FROM clients ORDER BY id LIMIT 1`)).rows[0].id as number;
    const before = (await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n as number;
    const s = await loginAs('semen');
    const r = await s.post('/api/works', refill(clientId, { newOrder: true }, users.kataev));
    expect(r.status).toBe(201);
    expect(r.body.orderId).toBeGreaterThan(0);
    expect(r.body.orderNumber).toMatch(/^\d+$/);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(before + 1);
    const w = (await pool.query('SELECT order_id, qty, device_id FROM device_works WHERE id = $1', [r.body.id])).rows[0];
    expect(w.order_id).toBe(r.body.orderId);
    expect(w.qty).toBe(3);
    expect(w.device_id).not.toBeNull();
    const t = (await pool.query('SELECT assignee_id FROM tasks WHERE order_id = $1', [r.body.orderId])).rows;
    expect(t.length).toBeGreaterThan(0);
    expect(t[0].assignee_id).toBe(users.kataev);
  });

  it('без newOrder заявка не создаётся, с выбранной заявкой пишется в неё', async () => {
    const { users } = await dict();
    const clientId = (await pool.query(`SELECT id FROM clients ORDER BY id LIMIT 1`)).rows[0].id as number;
    const orderId = (await pool.query('SELECT id FROM orders ORDER BY id LIMIT 1')).rows[0].id as number;
    const s = await loginAs('semen');
    const before = (await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n as number;
    const plain = await s.post('/api/works', refill(clientId, {}, users.kataev));
    expect(plain.status).toBe(201);
    expect(plain.body.orderId).toBeNull();
    const attached = await s.post('/api/works', refill(clientId, { orderId, newOrder: true }, users.kataev));
    expect(attached.status).toBe(201);
    expect(attached.body.orderId).toBe(orderId);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(before);
  });
});
