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
