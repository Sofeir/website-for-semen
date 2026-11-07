import ExcelJS from 'exceljs';
import { many, tx, type Db } from '../db/pool';

/** Строка выгрузки контрагентов (из 1С): колонки «Наименование в программе», ИНН, КПП, «Ответственный», «Полное наименование». */
export interface CounterpartyRow {
  line: number;
  name: string;
  inn: string;
  kpp: string;
  fullName: string;
  /** Строка серая: в 1С такой организации больше нет, её не добавляем. */
  gray: boolean;
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
  /** Сколько серых строк (организаций, которых в 1С уже нет) попало в файл. По решению заказчика добавляются тоже; skipGray их пропускает. */
  gray: number;
  /** Клиенты, у которых ИНН не из 10/12 цифр или КПП не из 9 (в 1С цифры потерялись): записаны как в файле, без достройки. */
  unusual: string[];
}

/** Цвет шрифта серых строк в выгрузке (так 1С показывает организации, которых больше нет). */
const GRAY_FONT = 'FF807A59';

/** Больше строк в выгрузке контрагентов не читаем: файл с миллионом строк не должен съесть память сервера. */
export const MAX_COUNTERPARTY_ROWS = 5000;

const HEADERS = ['Наименование в программе', 'ИНН', 'КПП', 'Ответственный', 'Полное наименование'];

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** Ключ для сравнения названий: без регистра, кавычек и пробелов. */
const nameKey = (v: string) => v.toLowerCase().replace(/[\s"«»“”„'.,]/g, '');

export async function readCounterparties(source: string | Buffer): Promise<CounterpartyRow[]> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === 'string') await wb.xlsx.readFile(source);
  else await wb.xlsx.load(source as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('В файле нет листов');
  if (ws.rowCount > MAX_COUNTERPARTY_ROWS + 1) throw new Error(`В файле больше ${MAX_COUNTERPARTY_ROWS} строк. Разделите его на части`);
  const head = HEADERS.map((_, i) => clean(ws.getRow(1).getCell(i + 1).text));
  if (head[0] !== HEADERS[0] || head[1] !== HEADERS[1]) {
    throw new Error(`Первая строка должна содержать колонки: ${HEADERS.join(', ')}. Сейчас: ${head.join(', ')}`);
  }
  const rows: CounterpartyRow[] = [];
  ws.eachRow((row, line) => {
    if (line === 1) return;
    const name = clean(row.getCell(1).text);
    if (!name) return;
    const gray = row.getCell(1).font?.color?.argb === GRAY_FONT;
    rows.push({ line, name, inn: clean(row.getCell(2).text), kpp: clean(row.getCell(3).text), fullName: clean(row.getCell(5).text), gray });
  });
  return rows;
}

/** Оставляет в ИНН и КПП только цифры: слэши, пробелы и прочий мусор из 1С убираются, сами цифры не трогаются и не достраиваются. */
export function digitsOnly(raw: string): string | null {
  const v = raw.replace(/\D/g, '');
  return v || null;
}

/** Вместо ИНН в выгрузке бывает телефон, например «+7(34377)»: такое значение (и КПП рядом) записываем как есть. */
export const looksLikePhone = (raw: string) => /[+()]/.test(raw);

/**
 * Решает, кого заводить: все строки, в том числе серые (так решил заказчик; skipGray их пропускает). Не создаёт клиента, если такой ИНН уже есть
 * в базе или раньше в файле (в сервисе юрлицо ищется по ИНН), и если уже есть клиент с таким же названием.
 */
export async function planClientsImport(rows: CounterpartyRow[], db?: Db, opts: { skipGray?: boolean } = {}): Promise<ImportPlan> {
  const existing = await many<{ id: number; name: string; inn: string | null }>('SELECT id, name, inn FROM clients', [], db);
  const byInn = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of existing) {
    if (c.inn) byInn.set(c.inn, `${c.name} (в базе, №${c.id})`);
    byName.set(nameKey(c.name), `${c.name} (в базе, №${c.id})`);
  }
  const plan: ImportPlan = { create: [], skipped: [], gray: 0, unusual: [] };
  for (const r of rows) {
    if (r.gray) {
      plan.gray++;
      if (opts.skipGray) continue;
    }
    const phone = looksLikePhone(r.inn);
    const inn = phone ? r.inn : digitsOnly(r.inn);
    const kpp = phone ? r.kpp || null : digitsOnly(r.kpp);
    const key = nameKey(r.name);
    const dup = (inn && byInn.get(inn) && `тот же ИНН ${inn}: ${byInn.get(inn)}`) || (byName.get(key) && `то же название: ${byName.get(key)}`);
    if (dup) {
      plan.skipped.push({ line: r.line, name: r.name, reason: dup });
      continue;
    }
    const notes: string[] = [];
    if (r.fullName && nameKey(r.fullName) !== key) notes.push(`Полное наименование: ${r.fullName}`);
    const odd: string[] = [];
    if (inn && inn.length !== 10 && inn.length !== 12) odd.push(`ИНН ${inn}`);
    if (kpp && kpp.length !== 9) odd.push(`КПП ${kpp}`);
    if (odd.length) plan.unusual.push(`строка ${r.line}: ${r.name} — ${odd.join(', ')}`);
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
