import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, intakeLaptop, loginAs, resetDb } from './helpers';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('учёт техники, виды задач и отчёты', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('журнал работ: запись по заявке попадает в историю устройства, у отчёта верные итоги', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-21');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;

    const add = await semen.post('/api/works', { orderId, kind: 'part', title: 'Блок фотобарабана', qty: 1, counter: 80000 });
    expect(add.status).toBe(201);
    const refill = await semen.post('/api/works', { clientId: order.clientId, kind: 'refill', title: 'CF259A', qty: 5 });
    expect(refill.status).toBe(201);

    const works = (await semen.get(`/api/devices/${order.device.id}/works`)).body;
    expect(works).toHaveLength(1);
    expect(works[0].counter).toBe(80000);

    const report = (await semen.get(`/api/reports/monthly?month=${thisMonth()}`)).body;
    const row = report.rows.find((r: any) => r.clientId === order.clientId);
    expect(row.refills).toBe(5);
    expect(row.parts).toBe(1);
    expect(row.accepted).toBe(1);
    expect(report.totals.all.refills).toBe(report.totals.legal.refills + report.totals.person.refills);
  });

  it('отчёт по организации: заправки сложены по модели, работы отдельно', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-23');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    await semen.post('/api/works', { clientId: order.clientId, kind: 'refill', title: 'CF259A', qty: 2 });
    await semen.post('/api/works', { clientId: order.clientId, kind: 'refill', title: 'CF259A', qty: 3 });
    await semen.post('/api/works', { orderId, kind: 'part', title: 'Фотобарабан', qty: 1, counter: 90000 });
    const r = (await semen.get(`/api/reports/client/${order.clientId}?month=${thisMonth()}`)).body;
    // итоги те же, что в строке отчёта; каждая заправка отдельной записью
    expect(r.totals).toMatchObject({ accepted: 1, refills: 5 });
    expect(r.refills.map((x: any) => x.qty)).toEqual([2, 3]);
    // работа по заявке лежит внутри своей заявки, и у неё есть ссылка на заявку
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].acceptedInMonth).toBe(true);
    expect(r.orders[0].works).toHaveLength(1);
    expect(r.orders[0].works[0]).toMatchObject({ counter: 90000, orderId });
    expect(r.otherWorks).toHaveLength(0);
    const lenya = await loginAs('lenya');
    expect((await lenya.get(`/api/reports/client/${order.clientId}?month=${thisMonth()}`)).status).toBe(403);
  });

  it('паспорт техники: свой номер уникален у клиента', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-22');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const ok = await semen.put(`/api/devices/${order.device.id}`, { inventoryNo: 'ПК-001', location: 'Бухгалтерия', serial: null });
    expect(ok.status).toBe(200);
    const detail = (await semen.get(`/api/orders/${orderId}`)).body;
    expect(detail.device.inventoryNo).toBe('ПК-001');
  });

  it('журнал чужой техники закрыт для мастера, свой открыт', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-24');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const lenya = await loginAs('lenya');
    expect((await lenya.get(`/api/devices/${order.device.id}/works`)).status).toBe(403);
    expect((await lenya.put(`/api/devices/${order.device.id}`, { inventoryNo: 'X-1' })).status).toBe(403);
    const stas = await loginAs('stas');
    expect((await stas.get(`/api/devices/${order.device.id}/works`)).status).toBe(200);
  });

  it('отчёты закрыты для мастера', async () => {
    const lenya = await loginAs('lenya');
    const r = await lenya.get(`/api/reports/monthly?month=${thisMonth()}`);
    expect(r.status).toBe(403);
  });

  it('виды задач: можно добавить свой, задача по заявке получает «Технику»', async () => {
    const semen = await loginAs('semen');
    const created = await semen.post('/api/task-kinds', { name: 'Совещания', color: 'violet' });
    expect(created.status).toBe(201);
    const dup = await semen.post('/api/task-kinds', { name: 'совещания', color: 'blue' });
    expect(dup.status).toBe(409);
    const kinds = (await semen.get('/api/task-kinds')).body;
    expect(kinds.map((k: any) => k.name)).toEqual(expect.arrayContaining(['Техника', 'Общие', 'Выезды', 'Совещания']));
  });
});
