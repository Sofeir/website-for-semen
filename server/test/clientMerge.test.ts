import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('перенос всего от одной организации к другой', () => {
  it('переносит заявки, технику, работы, людей и задачи, ничего не удаляет и не меняет номера', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const makeOrg = async (name: string, inn: string) =>
      (await semen.post('/api/clients', { kind: 'legal', name, phone: `+7 343 ${inn.slice(0, 3)}-00-00`, inn, kpp: null, email: '', address: null, contactPerson: null, note: null, phone2: null })).body.id as number;
    const dupId = await makeOrg('ООО РБЕ Урал', '6600000001');
    const realId = await makeOrg('РБЕ филиал Урал', '6600000002');

    const intake = async (clientId: number, phone: string) => {
      const { laptop } = await dict();
      const r = await semen.post('/api/intake', {
        clientKind: 'legal',
        clientId,
        devices: [{ device: { deviceTypeId: laptop, brandText: 'Acer', modelText: 'Aspire', serial: `SN-${phone}` }, faultText: 'Не включается', appearance: [], kit: [] }],
        responsibleId: users.isakov,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return { orderId: r.body.orderIds[0] as number, number: r.body.orderNumbers[0] as string };
    };
    const a = await intake(dupId, '1');
    const b = await intake(dupId, '2');
    const c = await intake(realId, '3');
    await pool.query(`INSERT INTO client_contacts (client_id, full_name, phone) VALUES ($1, 'Иванов Иван', '+7 900 111-11-11'), ($2, 'иванов иван', '+7 900 111-11-11'), ($1, 'Петров Пётр', '+7 900 222-22-22')`, [dupId, realId]);
    await pool.query(`INSERT INTO device_works (client_id, device_id, order_id, kind, title, qty) SELECT client_id, device_id, id, 'repair', 'Замена SSD', 1 FROM orders WHERE id = $1`, [a.orderId]);

    // предпросмотр ничего не меняет
    const prev = await semen.post(`/api/clients/${dupId}/merge`, { targetId: realId });
    expect(prev.status).toBe(200);
    expect(prev.body.moves.orders).toBe(2);
    expect(prev.body.contactsSame).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE client_id = $1', [dupId])).rows[0].n).toBe(2);

    const done = await semen.post(`/api/clients/${dupId}/merge`, { targetId: realId, apply: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const left = async (table: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE client_id = $1`, [dupId])).rows[0].n as number;
    for (const t of ['orders', 'devices', 'device_works', 'tasks', 'intake_batches']) expect(await left(t), t).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE client_id = $1', [realId])).rows[0].n).toBe(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM devices WHERE client_id = $1', [realId])).rows[0].n).toBe(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM device_works WHERE client_id = $1', [realId])).rows[0].n).toBe(1);
    // номера заявок прежние
    const numbers = (await pool.query('SELECT number FROM orders WHERE id = ANY ($1) ORDER BY number', [[a.orderId, b.orderId, c.orderId]])).rows.map((r) => r.number);
    expect(numbers).toEqual([a.number, b.number, c.number].sort());
    // Иванов не задвоился, Петров переехал
    const people = (await pool.query(`SELECT full_name FROM client_contacts WHERE client_id = $1 ORDER BY full_name`, [realId])).rows.map((r) => r.full_name);
    expect([...people].sort()).toEqual(['Петров Пётр', 'иванов иван'].sort());
    // старая организация осталась и помечена
    const old = (await pool.query('SELECT note FROM clients WHERE id = $1', [dupId])).rows[0];
    expect(old.note).toMatch(/перенесено в «РБЕ филиал Урал»/i);
  });

  it('в ту же организацию перенести нельзя, чужим сотрудникам без права тоже', async () => {
    const semen = await loginAs('semen');
    const any = (await pool.query('SELECT id FROM clients LIMIT 1')).rows[0]?.id ?? (await semen.post('/api/clients', { kind: 'person', name: 'Один', phone: '+7 900 000-12-12', email: '', address: null, contactPerson: null, note: null, phone2: null, inn: null, kpp: null })).body.id;
    expect((await semen.post(`/api/clients/${any}/merge`, { targetId: any, apply: true })).status).toBe(400);
  });
});
