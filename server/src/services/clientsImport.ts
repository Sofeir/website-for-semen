import ExcelJS from 'exceljs';
import { many, tx, type Db } from '../db/pool';

/** Строка выгрузки контрагентов (из 1С): колонки «Наименование в программе», ИНН, КПП, «Ответственный», «Полное наименование». */
export interface CounterpartyRow {
  line: number;
  name: string;
  inn: string;
  kpp: string;
  fullName: string;
}

export interface NewClient {
  line: number;
  name: string;
  inn: string | null;
  kpp: string | null;
  note: string | null;
}

export interface SkippedRow {
  line: number;
  name: string;
  reason: string;
}

export interface ImportPlan {
  create: NewClient[];
  skipped: SkippedRow[];
  /** Строки, где ИНН или КПП в файле неверные: клиент заводится, а неверное значение уходит в заметку. */
  fixed: string[];
}

const HEADERS = ['Наименование в программе', 'ИНН', 'КПП', 'Ответственный', 'Полное наименование'];

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** Ключ для сравнения названий: без регистра, кавычек и пробелов. */
const nameKey = (v: string) => v.toLowerCase().replace(/[\s"«»“”„'.,]/g, '');

export async function readCounterparties(file: string): Promise<CounterpartyRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('В файле нет листов');
  const head = HEADERS.map((_, i) => clean(ws.getRow(1).getCell(i + 1).text));
  if (head[0] !== HEADERS[0] || head[1] !== HEADERS[1]) {
    throw new Error(`Первая строка должна содержать колонки: ${HEADERS.join(', ')}. Сейчас: ${head.join(', ')}`);
  }
  const rows: CounterpartyRow[] = [];
  ws.eachRow((row, line) => {
    if (line === 1) return;
    const name = clean(row.getCell(1).text);
    if (!name) return;
    rows.push({ line, name, inn: clean(row.getCell(2).text), kpp: clean(row.getCell(3).text), fullName: clean(row.getCell(5).text) });
  });
  return rows;
}

/** ИНН — 10 или 12 цифр. Мусор в конце вроде «6679083350\» отбрасывается. */
export function validInn(raw: string): string | null {
  const v = raw.replace(/\s/g, '').replace(/[^\d]+$/, '');
  return /^(\d{10}|\d{12})$/.test(v) ? v : null;
}

export function validKpp(raw: string): string | null {
  const v = raw.replace(/\s/g, '');
  return /^\d{9}$/.test(v) ? v : null;
}

/**
 * Решает, кого заводить. Не создаёт клиента, если такой ИНН уже есть в базе или раньше в файле
 * (в сервисе юрлицо ищется по ИНН), и если уже есть клиент с таким же названием.
 */
export async function planClientsImport(rows: CounterpartyRow[], db?: Db): Promise<ImportPlan> {
  const existing = await many<{ id: number; name: string; inn: string | null }>('SELECT id, name, inn FROM clients', [], db);
  const byInn = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of existing) {
    if (c.inn) byInn.set(c.inn, `${c.name} (в базе, №${c.id})`);
    byName.set(nameKey(c.name), `${c.name} (в базе, №${c.id})`);
  }
  const plan: ImportPlan = { create: [], skipped: [], fixed: [] };
  for (const r of rows) {
    const inn = validInn(r.inn);
    const kpp = validKpp(r.kpp);
    const key = nameKey(r.name);
    const dup = (inn && byInn.get(inn) && `тот же ИНН ${inn}: ${byInn.get(inn)}`) || (byName.get(key) && `то же название: ${byName.get(key)}`);
    if (dup) {
      plan.skipped.push({ line: r.line, name: r.name, reason: dup });
      continue;
    }
    const notes: string[] = [];
    if (r.fullName && nameKey(r.fullName) !== key) notes.push(`Полное наименование: ${r.fullName}`);
    const bad: string[] = [];
    if (r.inn && !inn) bad.push(`ИНН «${r.inn}»`);
    if (r.kpp && !kpp) bad.push(`КПП «${r.kpp}»`);
    if (bad.length) {
      notes.push(`В выгрузке из 1С неверные данные: ${bad.join(', ')}. Проверьте и впишите вручную.`);
      plan.fixed.push(`строка ${r.line}: ${r.name} — ${bad.join(', ')}`);
    }
    plan.create.push({ line: r.line, name: r.name.slice(0, 200), inn, kpp, note: notes.length ? notes.join('\n').slice(0, 2000) : null });
    if (inn) byInn.set(inn, `${r.name} (в этом файле, строка ${r.line})`);
    byName.set(key, `${r.name} (в этом файле, строка ${r.line})`);
  }
  return plan;
}

/** Заводит клиентов из плана одной транзакцией: либо все, либо ни одного. Все — юрлица. */
export async function importClients(plan: ImportPlan): Promise<number> {
  return tx(async (c) => {
    for (const n of plan.create) {
      await c.query(`INSERT INTO clients (kind, name, inn, kpp, note) VALUES ('legal', $1, $2, $3, $4)`, [n.name, n.inn, n.kpp, n.note]);
    }
    return plan.create.length;
  });
}
