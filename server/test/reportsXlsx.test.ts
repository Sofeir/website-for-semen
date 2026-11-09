import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { pool } from '../src/db/pool';
import { groupWorks, worksText, type MonthWork } from '../src/services/monthWorks';
import { loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

/** supertest по умолчанию не собирает бинарный ответ: берём байты как есть. */
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Uint8Array) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const w = (p: Partial<MonthWork>): MonthWork => ({
  id: 1, clientId: 1, clientName: 'Школяр', kind: 'refill', title: 'ТК-1150', qty: 1, amount: null, ops: [], doneAt: new Date(), orderNumber: null, ...p,
});

describe('работы за месяц в формате их таблицы', () => {
  it('одинаковые работы складываются, картриджи всегда с количеством', () => {
    const list = [w({ qty: 2, amount: 600 }), w({ id: 2, qty: 3, amount: 900 }), w({ id: 3, title: 'ТК-1170', qty: 1 }), w({ id: 4, kind: 'repair', title: 'Замена печки M2135', qty: 1 })];
    expect(groupWorks(list)).toHaveLength(3);
    expect(worksText(list)).toBe('ТК-1150 - 5 шт, ТК-1170 - 1 шт, Замена печки M2135');
    // другие операции — другая запись
    expect(worksText([w({ ops: ['замена ролика'] }), w({ id: 2, ops: [] })])).toBe('ТК-1150 - 1 шт (замена ролика), ТК-1150 - 1 шт');
  });

  async function readSheet(buf: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0]!;
    const rows: (string | number | null)[][] = [];
    ws.eachRow((row) => rows.push([1, 2, 3, 4, 5, 6].map((i) => (row.getCell(i).value as string | number | null) ?? null)));
    return rows;
  }

  it('общий отчёт: строка на организацию; по организации: каждая работа отдельно; без права отчётов закрыто', async () => {
    const semen = await loginAs('semen');
    const client = (await pool.query(`INSERT INTO clients (kind, name) VALUES ('legal', 'ООО Школяр') RETURNING id, name`)).rows[0];
    const year = new Date().getFullYear();
    const month = `${year}-03`;
    const at = `${year}-03-10 12:00`;
    await pool.query(
      `INSERT INTO device_works (client_id, kind, title, qty, done_at, amount) VALUES ($1, 'refill', 'ТК-1150', 2, $2, 600), ($1, 'refill', 'ТК-1150', 1, $2, 300), ($1, 'repair', 'Замена печки', 1, $2, 3500)`,
      [client.id, at],
    );
    const all = await semen.get(`/api/reports/works.xlsx?month=${month}`).buffer(true).parse(binary);
    expect(all.status).toBe(200);
    expect(all.headers['content-type']).toContain('spreadsheetml');
    const rows = await readSheet(all.body as Buffer);
    expect(rows[0]).toEqual(['Договор', 'Фирма', 'Работы', 'СРВ', 'Согл', 'Уст']);
    const mine = rows.find((r) => r[1] === client.name)!;
    expect(mine[0]).toBe(4400);
    expect(mine[2]).toBe('ТК-1150 - 3 шт, Замена печки');

    const one = await semen.get(`/api/reports/client/${client.id}/works.xlsx?month=${month}`).buffer(true).parse(binary);
    expect(one.status).toBe(200);
    const own = await readSheet(one.body as Buffer);
    expect(own.slice(1).map((r) => [r[0], r[2]])).toEqual([
      [900, 'ТК-1150 - 3 шт'],
      [3500, 'Замена печки'],
      [4400, null],
    ]);
    expect(own[1]![1]).toBe(client.name);
    expect(own[3]![1]).toBe('Итого');

    expect((await semen.get('/api/reports/works.xlsx?month=2026-13')).status).toBe(400);
    const master = await loginAs('kataev');
    expect((await master.get(`/api/reports/works.xlsx?month=${month}`)).status).toBe(403);
  });
});
