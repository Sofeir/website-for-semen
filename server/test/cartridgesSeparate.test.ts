import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

/** Картриджи отдельно от техники: их задач нет в общих списках, а сами заявки есть и фильтруются по типу. */
describe('картриджи отдельно от техники', () => {
  it('задачи картриджей не видны в «Задачах», «Сегодня» и клиенте, но видны в самой заявке', async () => {
    const { users } = await dict();
    const typeId = (await pool.query(`SELECT id FROM device_types WHERE name = 'Картридж'`)).rows[0].id as number;
    const s = await loginAs('semen');
    const res = await s.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Картриджный клиент', phone: '+7 900 555-00-11' },
      devices: [{ device: { deviceTypeId: typeId, brandText: 'HP', modelText: '85A' }, faultText: 'Нужна заправка' }],
      responsibleId: users.isakov,
      dueAt: inDays(0),
    });
    expect(res.status).toBe(201);
    const cartridgeOrder = res.body.orderIds[0] as number;
    const cartridgeTask = (await pool.query('SELECT id FROM tasks WHERE order_id = $1', [cartridgeOrder])).rows[0];
    expect(cartridgeTask).toBeDefined();

    // обычная техника у другого клиента: её задача в списках остаётся
    const laptopOrder = await intakeLaptop(s, users.isakov, '+7 900 000-00-77');
    const laptopTask = (await pool.query('SELECT id FROM tasks WHERE order_id = $1', [laptopOrder])).rows[0];
    expect(laptopTask).toBeDefined();

    const isak = await loginAs('isakov');
    const mine = (await isak.get('/api/tasks?scope=mine')).body.map((t: any) => t.id);
    expect(mine).toContain(laptopTask.id);
    expect(mine).not.toContain(cartridgeTask.id);

    const all = (await s.get('/api/tasks?scope=all')).body.map((t: any) => t.id);
    expect(all).not.toContain(cartridgeTask.id);

    const dash = (await isak.get('/api/dashboard')).body;
    expect(dash.myTasksToday.map((t: any) => t.id)).not.toContain(cartridgeTask.id);

    // список задач одной заявки и сама задача по ссылке остаются доступны
    const ofOrder = (await s.get(`/api/tasks?scope=all&order=${cartridgeOrder}`)).body.map((t: any) => t.id);
    expect(ofOrder).toContain(cartridgeTask.id);
    expect((await isak.get(`/api/tasks/${cartridgeTask.id}`)).status).toBe(200);

    // карточка клиента: заявка есть, задач по картриджам нет
    const clientId = (await pool.query('SELECT client_id FROM orders WHERE id = $1', [cartridgeOrder])).rows[0].client_id as number;
    const client = (await s.get(`/api/clients/${clientId}`)).body;
    expect(client.orders.map((o: any) => o.id)).toContain(cartridgeOrder);
    expect(client.tasks.map((t: any) => t.id)).not.toContain(cartridgeTask.id);

    // заявки: фильтр по типу
    const cartridges = (await s.get('/api/orders?type=cartridge&issued=all')).body.map((o: any) => o.id);
    expect(cartridges).toContain(cartridgeOrder);
    expect(cartridges).not.toContain(laptopOrder);
    const equipment = (await s.get('/api/orders?type=equipment&issued=all')).body.map((o: any) => o.id);
    expect(equipment).toContain(laptopOrder);
    expect(equipment).not.toContain(cartridgeOrder);
    const everything = (await s.get('/api/orders?issued=all')).body.map((o: any) => o.id);
    expect(everything).toEqual(expect.arrayContaining([cartridgeOrder, laptopOrder]));
  });
});
