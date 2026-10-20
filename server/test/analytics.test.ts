import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { seedDemo } from '../src/db/seed';
import { seedHistory } from '../src/db/seedHistory';
import { loginAs, resetDb } from './helpers';

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

describe('аналитика', () => {
  beforeAll(async () => {
    await resetDb();
    await seedDemo();
    await seedHistory();
  });
  afterAll(() => pool.end());

  it('история заливается один раз', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
    await seedHistory();
    const after = (await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
    expect(after).toBe(before);
    expect(before).toBeGreaterThan(60);
  });

  it('руководитель видит месяц против месяца, динамику за год, мастеров, технику и клиентов', async () => {
    const semen = await loginAs('semen');
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const r = await semen.get(`/api/analytics?month=${monthKey(now)}&compare=${monthKey(prev)}`);
    expect(r.status).toBe(200);
    const a = r.body;
    expect(a.trend).toHaveLength(12);
    expect(a.trend[11].month).toBe(monthKey(now));
    expect(a.trend.reduce((s: number, p: any) => s + p.requests, 0)).toBeGreaterThan(40);
    expect(a.trend.some((p: any) => p.revenue > 0)).toBe(true);
    expect(a.masters.length).toBeGreaterThan(0);
    expect(a.masters[0]).toHaveProperty('position');
    expect(a.devices.length).toBeGreaterThan(0);
    expect(a.devices[0].revenue).toBeGreaterThan(0);
    expect(a.clients.length).toBeGreaterThan(0);
    expect(a.clients.some((c: any) => c.regular)).toBe(true);
    // фотобарабан МФУ заменили раньше расчётного ресурса
    expect(a.early.length).toBeGreaterThan(0);
    expect(a.early[0].passed).toBeLessThan(a.early[0].resource);
  });

  it('окно динамики не двигается за выбранным месяцем', async () => {
    const semen = await loginAs('semen');
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const a = (await semen.get(`/api/analytics?month=${monthKey(prev)}`)).body;
    expect(a.trend[11].month).toBe(monthKey(now));
    expect(a.trend.some((p: any) => p.month === monthKey(prev))).toBe(true);
    // выбран месяц старше окна: окно сдвигается, чтобы он был виден
    const old = new Date(now.getFullYear(), now.getMonth() - 20, 1);
    const b = (await semen.get(`/api/analytics?month=${monthKey(old)}`)).body;
    expect(b.trend.some((p: any) => p.month === monthKey(old))).toBe(true);
  });

  it('в инженерах нет директора, у инженера открывается список его работ с суммой', async () => {
    const semen = await loginAs('semen');
    const month = monthKey(new Date());
    const a = (await semen.get(`/api/analytics?month=${month}`)).body;
    expect(a.masters.some((m: any) => m.userId === semen.user.id)).toBe(false);
    const engineer = a.masters[0];
    const d = await semen.get(`/api/analytics/master/${engineer.userId}?month=${month}`);
    expect(d.status).toBe(200);
    expect(d.body.works.length).toBe(engineer.works);
    expect(Math.round(d.body.total)).toBe(Math.round(engineer.revenue));
    const lenya = await loginAs('lenya');
    expect((await lenya.get(`/api/analytics/master/${engineer.userId}?month=${month}`)).status).toBe(403);
  });

  it('цифры в подробностях клиента совпадают со строкой месячного отчёта', async () => {
    const semen = await loginAs('semen');
    const month = monthKey(new Date());
    const report = (await semen.get(`/api/reports/monthly?month=${month}`)).body;
    expect(report.rows.length).toBeGreaterThan(2);
    for (const row of report.rows) {
      const d = (await semen.get(`/api/reports/client/${row.clientId}?month=${month}`)).body;
      expect(d.totals).toEqual({ accepted: row.accepted, repaired: row.repaired, declined: row.declined, refills: row.refills });
      // принятые заявки из списка совпадают с числом «заявок» в строке
      expect(d.orders.filter((o: any) => o.acceptedInMonth)).toHaveLength(row.accepted);
      // у каждой записи, привязанной к заявке, есть номер для перехода
      for (const w of [...d.refills, ...d.otherWorks]) if (w.orderId) expect(w.orderNumber).toBeTruthy();
    }
  });

  it('аналитику видят только директор и руководитель системного администрирования', async () => {
    expect((await (await loginAs('admin')).get('/api/analytics')).status).toBe(200);
    expect((await (await loginAs('lenya')).get('/api/analytics')).status).toBe(403);
    expect((await (await loginAs('stas')).get('/api/analytics')).status).toBe(403);
  });

  it('неверный месяц — понятная ошибка', async () => {
    const semen = await loginAs('semen');
    expect((await semen.get('/api/analytics?month=сегодня')).status).toBe(400);
  });
});
