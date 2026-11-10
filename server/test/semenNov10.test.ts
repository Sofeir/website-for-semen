import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('пробег принтера при приёме', () => {
  it('пробег МФУ записывается в журнал техники и виден среди работ заявки', async () => {
    const { users } = await dict();
    const printer = (await pool.query(`SELECT id FROM device_types WHERE name = 'Принтеры/МФУ'`)).rows[0].id as number;
    const stas = await loginAs('isakov');
    const res = await stas.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Клиент с МФУ', phone: '+7 900 555-00-01' },
      devices: [
        { device: { deviceTypeId: printer, brandText: 'HP', modelText: 'LaserJet P1102', serial: 'PR1' }, faultText: 'Не печатает', counter: 48210 },
      ],
      responsibleId: users.kataev,
      dueAt: inDays(1),
    });
    expect(res.status).toBe(201);
    const orderId = res.body.orderIds[0];
    const order = (await stas.get(`/api/orders/${orderId}`)).body;
    expect(order.works).toHaveLength(1);
    expect(order.works[0]).toMatchObject({ title: 'Пробег при приёме', counter: 48210, kind: 'service' });
  });

  it('у ноутбука пробега нет: поле игнорируется', async () => {
    const { users, laptop } = await dict();
    const stas = await loginAs('isakov');
    const res = await stas.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Клиент с ноутбуком', phone: '+7 900 555-00-02' },
      devices: [{ device: { deviceTypeId: laptop, brandText: 'Acer', modelText: 'A5', serial: 'L1' }, faultText: 'Не включается', counter: 100 }],
      responsibleId: users.kataev,
      dueAt: inDays(1),
    });
    expect(res.status).toBe(201);
    const works = (await pool.query(`SELECT 1 FROM device_works WHERE order_id = $1`, [res.body.orderIds[0]])).rows;
    expect(works).toHaveLength(0);
  });
});

describe('задачи и уведомления по заявке', () => {
  it('в списке задач у задачи по заявке есть техника и клиент, в уведомлении тоже', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 555-00-03');
    const kataev = await loginAs('kataev');
    const created = await semen.post('/api/tasks', {
      title: `По заявке: проверить`,
      orderId,
      assigneeId: users.kataev,
      startAt: new Date().toISOString(),
      dueAt: inDays(1),
    });
    expect(created.status).toBe(201);
    const list = (await kataev.get('/api/tasks?scope=mine')).body as any[];
    const t = list.find((x) => x.id === created.body.id);
    expect(t.deviceTitle).toContain('Aspire 5');
    expect(t.clientName).toBe('Тестовый Клиент');

    const notice = (await pool.query(`SELECT body FROM notifications WHERE link = $1 AND type = 'task_assigned'`, [`/tasks?task=${created.body.id}`])).rows[0];
    expect(notice.body).toContain('Тестовый Клиент');
    expect(notice.body).toContain('Aspire 5');
  });
});

describe('согласование с клиентом', () => {
  it('запись о разговоре сохраняется вместе со сроком и суммой', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 555-00-04');
    const r = await semen.put(`/api/orders/${orderId}/agreed`, {
      agreedTerm: 'до пятницы',
      agreedSum: 4500,
      agreedNote: 'Озвучил 4500, предложил два варианта, клиент подумает до завтра',
    });
    expect(r.status).toBe(200);
    const o = (await semen.get(`/api/orders/${orderId}`)).body;
    expect(o).toMatchObject({ agreedTerm: 'до пятницы', agreedSum: 4500 });
    expect(o.agreedNote).toContain('два варианта');
    const list = (await semen.get('/api/orders')).body as any[];
    expect(list.find((x) => x.id === orderId).acceptedById).toBe(users.semen);
  });
});
