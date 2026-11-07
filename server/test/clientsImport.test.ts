import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { digitsOnly, importClients, looksLikePhone, planClientsImport, readCounterparties } from '../src/services/clientsImport';
import request from 'supertest';
import { app, PASSWORD, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

const GRAY = 'FF807A59';

async function xlsx(rows: { cells: (string | null)[]; gray?: boolean }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист_1');
  ws.addRow(['Наименование в программе', 'ИНН', 'КПП', 'Ответственный', 'Полное наименование']);
  for (const r of rows) {
    const row = ws.addRow(r.cells);
    if (r.gray) row.eachCell((c) => (c.font = { color: { argb: GRAY } }));
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kontr-')), 'k.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

describe('импорт контрагентов в клиенты', () => {
  it('в ИНН и КПП оставляет только цифры и ничего не достраивает', () => {
    expect(digitsOnly('6679083350\\')).toBe('6679083350');
    expect(digitsOnly('\\ 6658010')).toBe('6658010');
    expect(digitsOnly('/ 6679010')).toBe('6679010');
    expect(digitsOnly('44525593\\7')).toBe('445255937');
    expect(digitsOnly('')).toBeNull();
    expect(looksLikePhone('+7(34377)')).toBe(true);
    expect(looksLikePhone('6671993301')).toBe(false);
  });

  it('добавляет и серые строки, пропускает дубли, чистит ИНН и КПП, телефон вместо ИНН оставляет как есть', async () => {
    await pool.query(`INSERT INTO clients (kind, name, inn) VALUES ('legal', 'ООО Старый', '7707083893')`);
    const file = await xlsx([
      { cells: ['ООО "Новый"', '6671993301', '667101001', null, 'Общество "Новый"'] },
      { cells: ['ООО "Дубль по ИНН"', '7707083893', null, null, 'ООО "Дубль по ИНН"'] },
      { cells: ['ооо «старый»', '', null, null, 'ООО Старый'] },
      { cells: ['ООО "Кривой КПП"', '6670284775', '\\ 6670010', null, 'ООО "Кривой КПП"'] },
      { cells: ['ООО "Серый"', '6600000001', '660001001', null, 'ООО "Серый"'], gray: true },
      { cells: ['ООО  "Новый"', '6671993301', null, null, 'повтор в файле'] },
      { cells: ['ИП Без ИНН', null, null, null, 'Индивидуальный предприниматель Без ИНН'] },
      { cells: ['ФБУЗ Телефон', '+7(34377)', '-10-37', null, 'ФБУЗ Телефон'] },
    ]);
    const rows = await readCounterparties(file);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.gray).map((r) => r.name)).toEqual(['ООО "Серый"']);

    const plan = await planClientsImport(rows);
    expect(plan.gray).toBe(1);
    expect(plan.create.map((c) => c.name)).toEqual(['ООО "Новый"', 'ООО "Кривой КПП"', 'ООО "Серый"', 'ИП Без ИНН', 'ФБУЗ Телефон']);
    expect(plan.skipped.map((s) => s.line)).toEqual([3, 4, 7]);
    expect(plan.create[0]).toMatchObject({ inn: '6671993301', kpp: '667101001', note: 'Полное наименование: Общество "Новый"' });
    expect(plan.create[1]).toMatchObject({ inn: '6670284775', kpp: '6670010' });
    expect(plan.unusual).toEqual(['строка 5: ООО "Кривой КПП" — КПП 6670010', 'строка 9: ФБУЗ Телефон — ИНН +7(34377), КПП -10-37']);
    expect(plan.create[4]).toMatchObject({ inn: '+7(34377)', kpp: '-10-37', note: null });

    expect(await importClients(plan)).toBe(5);
    const saved = (await pool.query(`SELECT kind, name, inn, kpp FROM clients WHERE name = 'ООО "Кривой КПП"'`)).rows;
    expect(saved).toEqual([{ kind: 'legal', name: 'ООО "Кривой КПП"', inn: '6670284775', kpp: '6670010' }]);
    expect((await pool.query(`SELECT 1 FROM clients WHERE name = 'ООО "Серый"'`)).rowCount).toBe(1);
    // повторный запуск ничего не добавляет
    expect((await planClientsImport(rows)).create).toHaveLength(0);
    // со skipGray серые строки не добавляются
    const noGray = await planClientsImport(rows, undefined, { skipGray: true });
    expect(noGray.create).toHaveLength(0);
  });

  it('не принимает файл с другими колонками', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['Имя', 'Телефон']);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kontr-')), 'bad.xlsx');
    await wb.xlsx.writeFile(file);
    await expect(readCounterparties(file)).rejects.toThrow('Первая строка должна содержать колонки');
  });

  it('через сайт: просмотр, затем добавление; сотрудник без права не загружает', async () => {
    const file = await xlsx([
      { cells: ['ООО "Сайт 1"', '6600000011', '660001001', null, 'ООО "Сайт 1"'] },
      { cells: ['ООО "Сайт 2"', '6600000012', null, null, 'ООО "Сайт 2"'], gray: true },
    ]);
    const login = async (name: string) => {
      const agent = request.agent(app);
      const res = await agent.post('/api/auth/login').send({ login: name, password: PASSWORD, remember: false });
      return { agent, csrf: res.body.csrfToken as string };
    };
    const master = await login('kataev');
    const denied = await master.agent.post('/api/import/counterparties/preview').set('X-CSRF-Token', master.csrf).attach('file', file);
    expect(denied.status).toBe(403);

    const semen = await login('semen');
    const prev = await semen.agent.post('/api/import/counterparties/preview').set('X-CSRF-Token', semen.csrf).attach('file', file);
    expect(prev.status).toBe(200);
    expect(prev.body).toMatchObject({ totalRows: 2, gray: 1, willCreate: 2 });
    expect((await pool.query(`SELECT 1 FROM clients WHERE name LIKE 'ООО "Сайт%'`)).rowCount).toBe(0);
    const done = await semen.agent.post('/api/import/counterparties/commit').set('X-CSRF-Token', semen.csrf).send({ token: prev.body.token });
    expect(done.body).toEqual({ created: 2 });
    expect((await pool.query(`SELECT 1 FROM clients WHERE name LIKE 'ООО "Сайт%'`)).rowCount).toBe(2);
    // повторное подтверждение того же файла не проходит
    const again = await semen.agent.post('/api/import/counterparties/commit').set('X-CSRF-Token', semen.csrf).send({ token: prev.body.token });
    expect(again.status).toBe(410);
  });
});
