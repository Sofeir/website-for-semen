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
