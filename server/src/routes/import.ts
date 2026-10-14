import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { importCommitSchema, IMPORT_FIELDS, normalizePhone, type ImportField, type ImportPreview } from '@sd/shared';
import { many, one, tx } from '../db/pool';
import { h, HttpError, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { broadcast } from '../notify/hub';

export const importRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/** Разобранные файлы ждут подтверждения 30 минут. */
const pending = new Map<string, { userId: number; headers: string[]; rows: string[][]; expires: number }>();

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('ru-RU');
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('hyperlink' in v) return String((v as any).text ?? v.hyperlink);
    return '';
  }
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/** Угадываем колонки по заголовкам. */
const HINTS: Record<ImportField, RegExp> = {
  name: /(фио|имя|клиент|наименование|название|организац|контрагент)/i,
  phone: /(телефон|тел\.?|phone|мобильн)/i,
  phone2: /(доп.*тел|телефон ?2|второй тел)/i,
  email: /(e-?mail|почт)/i,
  address: /(адрес)/i,
  inn: /(инн)/i,
  contactPerson: /(контакт)/i,
  note: /(примеч|коммент|заметк)/i,
  deviceType: /(тип|вид техн|техника|устройство)/i,
  brand: /(марка|бренд|производ)/i,
  model: /(модель)/i,
  serial: /(сер.*ном|s\/n|serial|imei)/i,
};

function suggest(headers: string[]) {
  const used = new Set<number>();
  const result: Record<string, number> = {};
  // Сначала более узкие поля, чтобы «доп. телефон» не съел «телефон».
  const order: ImportField[] = [
    'phone2',
    'contactPerson',
    'serial',
    'inn',
    'email',
    'model',
    'brand',
    'deviceType',
    'phone',
    'address',
    'note',
    'name',
  ];
  for (const field of order) {
    const idx = headers.findIndex((h, i) => !used.has(i) && HINTS[field].test(h));
    if (idx >= 0) {
      result[field] = idx;
      used.add(idx);
    }
  }
  return result;
}

importRouter.post(
  '/import/preview',
  // Права проверяем до того, как multer примет файл.
  requirePermission('import.run'),
  upload.single('file'),
  h(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Выберите файл Excel или CSV');
    const ext = path.extname(file.originalname).toLowerCase();
    let table: string[][];
    if (ext === '.xlsx') {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(file.buffer as any);
      } catch {
        throw new HttpError(400, 'Не удалось прочитать файл. Сохраните его как .xlsx и попробуйте снова.');
      }
      const ws = wb.worksheets[0];
      if (!ws) throw new HttpError(400, 'В файле нет листов');
      table = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        for (let c = 1; c <= ws.columnCount; c++) values.push(cellText(row.getCell(c).value));
        table.push(values);
      });
    } else if (ext === '.csv') {
      table = parseCsv(file.buffer.toString('utf8').replace(/^﻿/, ''));
    } else {
      throw new HttpError(400, 'Подходят файлы .xlsx и .csv');
    }
    table = table.filter((r) => r.some((c) => c));
    if (table.length < 2) throw new HttpError(400, 'В файле нет строк с данными');
    const headers = table[0].map((h, i) => h || `Колонка ${i + 1}`);
    const rows = table.slice(1, 5001);
    const token = crypto.randomBytes(16).toString('hex');
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    pending.set(token, { userId: req.user!.id, headers, rows, expires: Date.now() + 30 * 60_000 });
    const preview: ImportPreview = {
      token,
      headers,
      rows: rows.slice(0, 20),
      totalRows: rows.length,
      suggested: suggest(headers),
    };
    res.json(preview);
  }),
);

importRouter.post(
  '/import/commit',
  requirePermission('import.run'),
  h(async (req, res) => {
    const input = parse(importCommitSchema, req.body);
    const job = pending.get(input.token);
    if (!job || job.userId !== req.user!.id || job.expires < Date.now()) {
      throw new HttpError(410, 'Файл устарел. Загрузите его ещё раз.');
    }
    if (input.mapping.name === undefined) throw new HttpError(400, 'Укажите колонку с именем или названием');
    for (const field of Object.keys(input.mapping)) {
      if (!(field in IMPORT_FIELDS)) throw new HttpError(400, `Неизвестное поле: ${field}`);
    }
    const get = (row: string[], f: ImportField) => {
      const idx = input.mapping[f];
      return idx === undefined ? '' : (row[idx] ?? '').trim();
    };
    const types = await many<{ id: number; name: string }>('SELECT id, name FROM device_types');
    const brands = await many<{ id: number; name: string; device_type_id: number }>(
      'SELECT id, name, device_type_id FROM brands',
    );
    const findType = (s: string) => {
      const v = s.toLowerCase();
      return v
        ? (types.find((t) => t.name.toLowerCase() === v) ?? types.find((t) => v.includes(t.name.toLowerCase())))
        : undefined;
    };

    const stats = { created: 0, existing: 0, devices: 0, skipped: 0, errors: [] as string[] };
    await tx(async (db) => {
      for (const [i, row] of job.rows.entries()) {
        const name = get(row, 'name');
        if (!name) {
          stats.skipped++;
          continue;
        }
        const phone = get(row, 'phone');
        const digits = phone ? normalizePhone(phone) : '';
        const inn = get(row, 'inn').replace(/\D/g, '');
        let client: { id: number } | undefined;
        if (input.kind === 'person' && digits.length === 11) {
          client = await one('SELECT id FROM clients WHERE phone_digits = $1 LIMIT 1', [digits], db);
        } else if (input.kind === 'legal' && inn) {
          client = await one('SELECT id FROM clients WHERE inn = $1 LIMIT 1', [inn], db);
        } else {
          client = await one(
            'SELECT id FROM clients WHERE lower(name) = lower($1) AND kind = $2 LIMIT 1',
            [name, input.kind],
            db,
          );
        }
        if (client) stats.existing++;
        else {
          client = await one(
            `INSERT INTO clients (kind, name, phone, phone_digits, phone2, email, address, inn, contact_person, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              input.kind,
              name.slice(0, 200),
              phone || null,
              digits || null,
              get(row, 'phone2') || null,
              get(row, 'email') || null,
              get(row, 'address') || null,
              /^\d{10}(\d{2})?$/.test(inn) ? inn : null,
              get(row, 'contactPerson') || null,
              get(row, 'note') || null,
              req.user!.id,
            ],
            db,
          );
          stats.created++;
        }
        const typeName = get(row, 'deviceType');
        if (typeName) {
          const type = findType(typeName);
          if (!type) {
            if (stats.errors.length < 20) stats.errors.push(`Строка ${i + 2}: тип техники «${typeName}» не найден в справочнике`);
            continue;
          }
          const serial = get(row, 'serial') || null;
          if (serial) {
            const dup = await one('SELECT 1 FROM devices WHERE client_id = $1 AND serial = $2', [client!.id, serial], db);
            if (dup) continue;
          }
          const brandText = get(row, 'brand');
          const brand = brands.find((b) => b.device_type_id === type.id && b.name.toLowerCase() === brandText.toLowerCase());
          await db.query(
            `INSERT INTO devices (client_id, device_type_id, brand_id, brand_text, model_text, serial) VALUES ($1, $2, $3, $4, $5, $6)`,
            [client!.id, type.id, brand?.id ?? null, brand ? null : brandText || null, get(row, 'model') || null, serial],
          );
          stats.devices++;
        }
      }
    });
    pending.delete(input.token);
    broadcast('changed', { scopes: ['clients'] });
    res.json(stats);
  }),
);
