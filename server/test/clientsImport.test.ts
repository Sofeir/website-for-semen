import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { digitsOnly, importClients, looksLikePhone, planClientsImport, readCounterparties } from '../src/services/clientsImport';
import { resetDb } from './helpers';

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

  it('пропускает серые строки и дубли, чистит ИНН и КПП, телефон вместо ИНН оставляет как есть', async () => {
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
    expect(plan.create.map((c) => c.name)).toEqual(['ООО "Новый"', 'ООО "Кривой КПП"', 'ИП Без ИНН', 'ФБУЗ Телефон']);
    expect(plan.skipped.map((s) => s.line)).toEqual([3, 4, 7]);
    expect(plan.create[0]).toMatchObject({ inn: '6671993301', kpp: '667101001', note: 'Полное наименование: Общество "Новый"' });
    expect(plan.create[1]).toMatchObject({ inn: '6670284775', kpp: '6670010' });
    expect(plan.unusual).toEqual(['строка 5: ООО "Кривой КПП" — КПП 6670010', 'строка 9: ФБУЗ Телефон — ИНН +7(34377), КПП -10-37']);
    expect(plan.create[3]).toMatchObject({ inn: '+7(34377)', kpp: '-10-37', note: null });

    expect(await importClients(plan)).toBe(4);
    const saved = (await pool.query(`SELECT kind, name, inn, kpp FROM clients WHERE name = 'ООО "Кривой КПП"'`)).rows;
    expect(saved).toEqual([{ kind: 'legal', name: 'ООО "Кривой КПП"', inn: '6670284775', kpp: '6670010' }]);
    expect((await pool.query(`SELECT 1 FROM clients WHERE name = 'ООО "Серый"'`)).rowCount).toBe(0);
    // повторный запуск ничего не добавляет
    expect((await planClientsImport(rows)).create).toHaveLength(0);
    // серые строки можно добавить позже отдельным запуском
    const grayPlan = await planClientsImport(rows, undefined, { onlyGray: true });
    expect(grayPlan.create.map((c) => c.name)).toEqual(['ООО "Серый"']);
  });

  it('не принимает файл с другими колонками', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['Имя', 'Телефон']);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kontr-')), 'bad.xlsx');
    await wb.xlsx.writeFile(file);
    await expect(readCounterparties(file)).rejects.toThrow('Первая строка должна содержать колонки');
  });
});
