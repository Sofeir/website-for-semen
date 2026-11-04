import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { clientsWithoutOrders, deleteClients, deleteOrders, listOrders } from '../src/services/testDataCleanup';
import { dict, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('чистка тестовых заявок', () => {
  it('удаляет выбранные заявки со всем зависимым и не трогает остальные', async () => {
    const { users } = await dict();
    const s = await loginAs('semen');
    const oldId = await intakeLaptop(s, users.isakov, '+7 900 000-00-11');
    const newId = await intakeLaptop(s, users.isakov, '+7 900 000-00-12');
    const old = (await pool.query('SELECT client_id, device_id FROM orders WHERE id = $1', [oldId])).rows[0];
    await pool.query(
      `INSERT INTO device_works (client_id, device_id, order_id, kind, title, qty, done_at, created_by) VALUES ($1, $2, $3, 'repair', 'Тест', 1, now(), $4)`,
      [old.client_id, old.device_id, oldId, users.isakov],
    );
    await pool.query(`INSERT INTO notifications (user_id, type, title, link) VALUES ($1, 'task', 'x', $2)`, [users.isakov, `/orders/${oldId}`]);

    const list = await listOrders();
    expect(list.map((o) => o.id)).toEqual(expect.arrayContaining([oldId, newId]));

    const res = await deleteOrders([oldId]);
    expect(res.orders).toBe(1);
    expect(res.tasks).toBeGreaterThan(0);
    expect(res.works).toBe(1);
    expect(res.devices).toBe(1);

    expect((await pool.query('SELECT 1 FROM orders WHERE id = $1', [oldId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM tasks WHERE order_id = $1', [oldId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM device_works WHERE order_id = $1', [oldId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM notifications WHERE link = $1', [`/orders/${oldId}`])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM orders WHERE id = $1', [newId])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM tasks WHERE order_id = $1', [newId])).rowCount).toBeGreaterThan(0);

    const left = await clientsWithoutOrders();
    expect(left.map((c) => c.id)).toContain(old.client_id);
    expect(await deleteClients([old.client_id])).toBe(1);
    expect((await pool.query('SELECT 1 FROM clients WHERE id = $1', [old.client_id])).rowCount).toBe(0);
  });

  it('не удаляет клиента, у которого остались заявки', async () => {
    const { users } = await dict();
    const s = await loginAs('semen');
    const id = await intakeLaptop(s, users.isakov, '+7 900 000-00-13');
    const clientId = (await pool.query('SELECT client_id FROM orders WHERE id = $1', [id])).rows[0].client_id as number;
    expect(await deleteClients([clientId])).toBe(0);
    expect((await pool.query('SELECT 1 FROM clients WHERE id = $1', [clientId])).rowCount).toBe(1);
  });
});
