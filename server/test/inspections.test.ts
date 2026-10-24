import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { intakeLaptop, loginAs, resetDb, dict } from './helpers';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('проверка техники на выезде', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('пункты чек-листов лежат в справочнике, правятся и входят в список', async () => {
    const semen = await loginAs('semen');
    const d = (await semen.get('/api/dictionaries')).body;
    expect(d.inspectPc).toHaveLength(7);
    expect(d.inspectPrinter).toHaveLength(7);
    const add = await semen.post('/api/dictionaries/inspect_pc', { name: 'Проверка принтера по сети' });
    expect(add.status).toBe(201);
    expect((await semen.get('/api/dictionaries')).body.inspectPc).toHaveLength(8);
    // внешний вид и комплектность не задеты
    expect(d.appearance.length).toBeGreaterThan(0);
  });

  it('проверка ноутбука пишется в журнал: очистка отдельной строкой, имя ПК и сотрудник запоминаются', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-31');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const items = [
      { title: 'Проверка антивируса', done: true },
      { title: 'Проверка резервных копий', done: false },
      { title: 'Очистка устройства от пыли', done: true },
    ];
    const r = await semen.post('/api/inspections', {
      deviceId: order.device.id,
      hostName: 'BUH-01',
      personName: 'Иванова Ольга',
      personPhone: '+7 900 111-22-33',
      counter: 5000,
      note: 'Заменить термопасту',
      items,
    });
    expect(r.status).toBe(201);

    const list = (await semen.get(`/api/clients/${order.clientId}/inspections`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'pc', hostName: 'BUH-01', personName: 'Иванова Ольга', counter: null });
    expect(list[0].items).toEqual(items);

    const works = (await semen.get(`/api/devices/${order.device.id}/works`)).body;
    const titles = works.map((w: any) => w.title);
    expect(titles).toContain('Проверка ПК');
    expect(titles).toContain('Очистка устройства от пыли');
    expect(works.find((w: any) => w.title === 'Проверка ПК').note).toContain('Пройдено 2 из 3');
    expect(works.find((w: any) => w.title === 'Проверка ПК').note).toContain('Проверка резервных копий');
  });

  it('техника без чек-листа и чужие мастера не проходят', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-32');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const comp = await semen.post(`/api/devices/${order.device.id}/components`, {
      deviceTypeId: (await pool.query(`SELECT id FROM device_types WHERE name = 'Мониторы'`)).rows[0].id,
      modelText: 'Монитор 27" Samsung',
    });
    expect(comp.status).toBe(201);
    const bad = await semen.post('/api/inspections', { deviceId: comp.body.id, items: [] });
    expect(bad.status).toBe(400);
    const lenya = await loginAs('lenya');
    const denied = await lenya.post('/api/inspections', { deviceId: order.device.id, items: [{ title: 'Проверка антивируса', done: true }] });
    expect(denied.status).toBe(403);
  });

  it('пробег принтера идёт в журнал, PDF формируется', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-33');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const printerType = (await pool.query(`SELECT id FROM device_types WHERE name = 'Принтеры/МФУ'`)).rows[0].id;
    const dev = await semen.post(`/api/devices/${order.device.id}/components`, { deviceTypeId: printerType, modelText: 'Kyocera M2040dn', serial: 'PR1' });
    const r = await semen.post('/api/inspections', {
      deviceId: dev.body.id,
      counter: 81234,
      items: [{ title: 'Проверка состояния фотобарабана', done: true }],
    });
    expect(r.status).toBe(201);
    const works = (await semen.get(`/api/devices/${dev.body.id}/works`)).body;
    expect(works[0]).toMatchObject({ title: 'Проверка МФУ / принтера', counter: 81234 });

    const one = await semen.get(`/api/documents/inspection/${r.body.id}.pdf`);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toContain('application/pdf');
    const month = await semen.get(`/api/documents/inspections/client/${order.clientId}.pdf?month=${thisMonth()}`);
    expect(month.status).toBe(200);
    const blank = await semen.get('/api/documents/inspection-blank/pc.pdf');
    expect(blank.status).toBe(200);
    expect((await semen.get('/api/documents/inspections/client/' + order.clientId + '.pdf?month=2020-01')).status).toBe(404);
  });

  // выезды

  it('закрытый выезд попадает в строку отчёта, подробности клиента и аналитику инженера', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-41');
    const clientId = (await semen.get(`/api/orders/${orderId}`)).body.clientId;
    const day = new Date();
    day.setHours(23, 0, 0, 0);
    const created = await semen.post('/api/tasks', {
      title: 'Выезд: клиент',
      assigneeId: users.lenya,
      clientId,
      startAt: new Date(Date.now() - 3_600_000).toISOString(),
      dueAt: day.toISOString(),
      checklist: ['Проверить резервные копии', 'Почистить ПК'],
      visit: true,
    });
    expect(created.status).toBe(201);
    const task = (await lenya.get(`/api/tasks/${created.body.id}`)).body;
    await lenya.post(`/api/tasks/${created.body.id}/checklist/${task.checklist[0].id}`, { done: true }).catch(() => null);
    const closed = await lenya.post('/api/tasks/close', { ids: [created.body.id], comment: 'Всё проверил' });
    expect(closed.status).toBe(200);

    const report = (await semen.get(`/api/reports/monthly?month=${thisMonth()}`)).body;
    expect(report.rows.find((r: any) => r.clientId === clientId).visits).toBe(1);
    expect(report.totals.all.visits).toBe(1);
    expect(report.totals.legal.visits + report.totals.person.visits).toBe(report.totals.all.visits);

    const detail = (await semen.get(`/api/reports/client/${clientId}?month=${thisMonth()}`)).body;
    expect(detail.totals.visits).toBe(1);
    expect(detail.visits).toHaveLength(1);
    expect(detail.visits[0]).toMatchObject({ title: 'Выезд: клиент', checklistTotal: 15, closeComment: 'Всё проверил' });
    expect(detail.visits[0].performerName).toContain('Катаев');

    const an = (await semen.get(`/api/analytics?month=${thisMonth()}`)).body;
    expect(an.current.visits).toBe(1);
    expect(an.masters.find((m: any) => m.userId === users.lenya).visits).toBe(1);
    const master = (await semen.get(`/api/analytics/master/${users.lenya}?month=${thisMonth()}`)).body;
    expect(master.visits).toHaveLength(1);
    expect(master.visits[0].clientId).toBe(clientId);
  });

  it('у любого выезда единый чек-лист, даже если передали другой', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-42');
    const clientId = (await semen.get(`/api/orders/${orderId}`)).body.clientId;
    const url = `/api/clients/${clientId}/service-checklist`;
    const plan = { title: 'Выезд: клиент', assigneeId: users.lenya, clientId, startAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3_600_000).toISOString(), visit: true };
    const first = await semen.post('/api/tasks', plan);
    expect(first.status).toBe(201);
    const std = (await semen.get(`/api/tasks/${first.body.id}`)).body.checklist.map((x: any) => x.title);
    expect(std).toHaveLength(15);
    expect(std[0]).toBe('Проверка состояния дисков');
    expect(std[14]).toBe('Пробег');
    expect((await semen.get(url)).body.items).toEqual(std);
    const second = await semen.post('/api/tasks', { ...plan, checklist: ['Свой пункт'] });
    expect((await semen.get(`/api/tasks/${second.body.id}`)).body.checklist.map((x: any) => x.title)).toEqual(std);
  });
});
