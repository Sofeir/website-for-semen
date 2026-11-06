import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { importClients, planClientsImport, readCounterparties, validInn, validKpp } from '../src/services/clientsImport';
import { resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

async function xlsx(rows: (string | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист_1');
  ws.addRow(['Наименование в программе', 'ИНН', 'КПП', 'Ответственный', 'Полное наименование']);
  for (const r of rows) ws.addRow(r);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kontr-')), 'k.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

describe('импорт контрагентов в клиенты', () => {
  it('проверяет ИНН и КПП и отбрасывает мусор в конце', () => {
    expect(validInn('6679083350\\')).toBe('6679083350');
    expect(validInn('665812546894')).toBe('665812546894');
    expect(validInn('+7(34377)')).toBeNull();
    expect(validInn('631724630')).toBeNull();
    expect(validKpp('668601001')).toBe('668601001');
    expect(validKpp('-10-37')).toBeNull();
  });

  it('добавляет новых, пропускает дубли по ИНН и названию, неверные ИНН пишет в заметку', async () => {
    await pool.query(`INSERT INTO clients (kind, name, inn) VALUES ('legal', 'ООО Старый', '7707083893')`);
    const file = await xlsx([
      ['ООО "Новый"', '6671993301', '667101001', null, 'Общество "Новый"'],
      ['ООО "Дубль по ИНН"', '7707083893', null, null, 'ООО "Дубль по ИНН"'],
      ['ооо «старый»', '', null, null, 'ООО Старый'],
      ['ООО "Кривой ИНН"', '44525593\\7', '0901001', null, 'ООО "Кривой ИНН"'],
      ['ООО  "Новый"', '6671993301', null, null, 'повтор в файле'],
      ['ИП Без ИНН', null, null, null, 'Индивидуальный предприниматель Без ИНН'],
    ]);
    const rows = await readCounterparties(file);
    expect(rows).toHaveLength(6);
    const plan = await planClientsImport(rows);
    expect(plan.create.map((c) => c.name)).toEqual(['ООО "Новый"', 'ООО "Кривой ИНН"', 'ИП Без ИНН']);
    expect(plan.skipped.map((s) => s.line)).toEqual([3, 4, 6]);
    expect(plan.create[0]).toMatchObject({ inn: '6671993301', kpp: '667101001', note: 'Полное наименование: Общество "Новый"' });
    expect(plan.create[1].inn).toBeNull();
    expect(plan.create[1].note).toContain('44525593\\7');

    expect(await importClients(plan)).toBe(3);
    const saved = (await pool.query(`SELECT kind, name, inn FROM clients WHERE name = 'ООО "Новый"'`)).rows;
    expect(saved).toEqual([{ kind: 'legal', name: 'ООО "Новый"', inn: '6671993301' }]);
    // повторный запуск ничего не добавляет
    expect((await planClientsImport(rows)).create).toHaveLength(0);
  });

  it('не принимает файл с другими колонками', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['Имя', 'Телефон']);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kontr-')), 'bad.xlsx');
    await wb.xlsx.writeFile(file);
    await expect(readCounterparties(file)).rejects.toThrow('Первая строка должна содержать колонки');
  });
});
