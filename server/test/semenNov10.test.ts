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

describe('история обращений по технике', () => {
  it('повторный приём той же техники: в паспорте видны обе заявки с пробегом и диагнозом', async () => {
    const { users } = await dict();
    const printer = (await pool.query(`SELECT id FROM device_types WHERE name = 'Принтеры/МФУ'`)).rows[0].id as number;
    const semen = await loginAs('semen');
    const first = await semen.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Постоянный клиент', phone: '+7 900 555-00-09' },
      devices: [{ device: { deviceTypeId: printer, brandText: 'Kyocera', modelText: 'M2040', serial: 'KY-1' }, faultText: 'Мнёт бумагу', counter: 30000 }],
      responsibleId: users.isakov,
      dueAt: inDays(1),
    });
    expect(first.status).toBe(201);
    const order1 = first.body.orderIds[0];
    const deviceId = (await pool.query('SELECT device_id FROM orders WHERE id = $1', [order1])).rows[0].device_id as number;
    const clientId = (await pool.query('SELECT client_id FROM orders WHERE id = $1', [order1])).rows[0].client_id as number;

    // диагностика → результат пишется при переводе на согласование
    const stages = (await pool.query(`SELECT id, code FROM stages`)).rows as { id: number; code: string }[];
    const approval = stages.find((s) => s.code === 'approval')!;
    const adv = await semen.post(`/api/orders/${order1}/advance`, {
      toStageId: approval.id,
      responsibleId: users.semen,
      dueAt: inDays(2),
      comment: 'Замена термоплёнки',
    });
    expect(adv.status).toBe(200);

    // через неделю тот же аппарат снова, с другой проблемой и другим пробегом
    const second = await semen.post('/api/intake', {
      clientKind: 'person',
      clientId,
      devices: [{ device: { id: deviceId, deviceTypeId: printer, brandText: 'Kyocera', modelText: 'M2040', serial: 'KY-1' }, faultText: 'Печатает полосами', counter: 36500 }],
      responsibleId: users.isakov,
      dueAt: inDays(1),
    });
    expect(second.status).toBe(201);
    const order2 = second.body.orderIds[0];

    // пробег записывается и из паспорта
    expect((await semen.post('/api/works', { deviceId, orderId: order2, kind: 'service', title: 'Показания счётчика', qty: 1, counter: 36510 })).status).toBe(201);

    const visits = (await semen.get(`/api/devices/${deviceId}/orders`)).body as any[];
    expect(visits.map((v) => v.orderId)).toEqual([order2, order1]);
    expect(visits[0]).toMatchObject({ counter: 36500, fault: 'Печатает полосами', diagnosis: null });
    expect(visits[1]).toMatchObject({ counter: 30000, fault: 'Мнёт бумагу', diagnosis: 'Замена термоплёнки' });
    const works = (await semen.get(`/api/devices/${deviceId}/works`)).body as any[];
    expect(works.map((w) => w.counter).sort()).toEqual([30000, 36500, 36510]);
  });

  it('мастер без доступа к технике историю не видит', async () => {
    const stranger = await loginAs('kataev');
    const deviceId = (await pool.query(`SELECT d.id FROM devices d WHERE NOT EXISTS (SELECT 1 FROM orders o JOIN users u ON u.login = 'kataev' WHERE o.device_id = d.id AND (o.responsible_id = u.id OR o.accepted_by = u.id)) ORDER BY d.id DESC LIMIT 1`)).rows[0].id as number;
    expect((await stranger.get(`/api/devices/${deviceId}/orders`)).status).toBe(403);
  });
});

describe('история обращений: чужие заявки урезаны', () => {
  it('мастер видит подробности только своей заявки, по остальным дату, пробег и итог', async () => {
    const { users } = await dict();
    const printer = (await pool.query(`SELECT id FROM device_types WHERE name = 'Принтеры/МФУ'`)).rows[0].id as number;
    const semen = await loginAs('semen');
    const a = await semen.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Клиент для урезания', phone: '+7 900 555-00-11' },
      devices: [{ device: { deviceTypeId: printer, brandText: 'Brother', modelText: 'HL-1', serial: 'BR-1' }, faultText: 'Серые полосы', counter: 1000 }],
      responsibleId: users.isakov,
      dueAt: inDays(1),
    });
    const orderA = a.body.orderIds[0];
    const row = (await pool.query('SELECT device_id, client_id FROM orders WHERE id = $1', [orderA])).rows[0];
    const stages = (await pool.query(`SELECT id, code FROM stages`)).rows as { id: number; code: string }[];
    await semen.post(`/api/orders/${orderA}/advance`, {
      toStageId: stages.find((s) => s.code === 'approval')!.id,
      responsibleId: users.semen,
      dueAt: inDays(2),
      comment: 'Секретный диагноз',
    });
    await semen.put(`/api/orders/${orderA}/agreed`, { agreedSum: 7777 });
    const b = await semen.post('/api/intake', {
      clientKind: 'person',
      clientId: row.client_id,
      devices: [{ device: { id: row.device_id, deviceTypeId: printer, brandText: 'Brother', modelText: 'HL-1', serial: 'BR-1' }, faultText: 'Не берёт бумагу', counter: 1500 }],
      responsibleId: users.kataev,
      dueAt: inDays(1),
    });
    const orderB = b.body.orderIds[0];

    const kataev = await loginAs('kataev');
    const visits = (await kataev.get(`/api/devices/${row.device_id}/orders`)).body as any[];
    const mine = visits.find((v) => v.orderId === orderB);
    const other = visits.find((v) => v.orderId === orderA);
    expect(mine).toMatchObject({ visible: true, fault: 'Не берёт бумагу', counter: 1500 });
    expect(other).toMatchObject({ visible: false, number: null, diagnosis: null, agreedSum: null, acceptedByName: null, counter: 1000, fault: 'Серые полосы' });
    expect(JSON.stringify(other)).not.toContain('Секретный');

    // руководитель видит всё
    const full = (await semen.get(`/api/devices/${row.device_id}/orders`)).body as any[];
    expect(full.find((v) => v.orderId === orderA)).toMatchObject({ visible: true, diagnosis: 'Секретный диагноз', agreedSum: 7777 });
  });
});
