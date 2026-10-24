import { Router } from 'express';
import {
  companySettingsSchema,
  dictionaryItemSchema,
  DICTIONARIES,
  workSettingsSchema,
  type DictionaryName,
  type Dictionaries,
} from '@sd/shared';
import { many, one, pool } from '../db/pool';
import { h, HttpError, intParam, parse } from '../lib/http';
import { requirePermission } from '../auth/session';
import { getCompanySettings, getWorkSettings, setSetting } from '../services/settings';
import { broadcast } from '../notify/hub';

export const dictionariesRouter = Router();

const base = `id, name, sort, is_active AS "isActive"`;

dictionariesRouter.get(
  '/dictionaries',
  h(async (_req, res) => {
    const [deviceTypes, brands, models, faults, checklist, services, warranties, stages] = await Promise.all([
      many(`SELECT ${base} FROM device_types ORDER BY sort, name`),
      many(`SELECT ${base}, device_type_id AS "parentId" FROM brands ORDER BY sort, name`),
      many(`SELECT ${base}, brand_id AS "parentId" FROM models ORDER BY sort, name`),
      many(`SELECT ${base}, device_type_id AS "parentId" FROM faults ORDER BY sort, name`),
      many(`SELECT ${base}, kind FROM checklist_items ORDER BY sort, id`),
      many(`SELECT ${base}, price, price_from AS "priceFrom", device_type_id AS "parentId" FROM services ORDER BY sort, name`),
      many(`SELECT ${base}, months, is_default AS "isDefault" FROM warranties ORDER BY months`),
      many(
        `SELECT id, code, name, sort, color, sla_hours AS "slaHours", is_final AS "isFinal", is_active AS "isActive"
           FROM stages ORDER BY sort, id`,
      ),
    ]);
    const data: Dictionaries = {
      deviceTypes,
      brands,
      models,
      faults,
      appearance: checklist.filter((c) => c.kind === 'appearance'),
      kit: checklist.filter((c) => c.kind === 'kit'),
      inspectPc: checklist.filter((c) => c.kind === 'inspect_pc'),
      inspectPrinter: checklist.filter((c) => c.kind === 'inspect_printer'),
      visitWorks: checklist.filter((c) => c.kind === 'visit'),
      services,
      warranties,
      stages,
    };
    res.set('Cache-Control', 'no-store');
    res.json(data);
  }),
);

/** Описание таблиц справочников: какие поля можно править из админки. */
const TABLES: Record<DictionaryName, { table: string; parent?: string; extra?: string[]; where?: string }> = {
  device_types: { table: 'device_types' },
  brands: { table: 'brands', parent: 'device_type_id' },
  models: { table: 'models', parent: 'brand_id' },
  faults: { table: 'faults', parent: 'device_type_id' },
  appearance: { table: 'checklist_items', where: `kind = 'appearance'` },
  kit: { table: 'checklist_items', where: `kind = 'kit'` },
  inspect_pc: { table: 'checklist_items', where: `kind = 'inspect_pc'` },
  inspect_printer: { table: 'checklist_items', where: `kind = 'inspect_printer'` },
  visit_works: { table: 'checklist_items', where: `kind = 'visit'` },
  services: { table: 'services', parent: 'device_type_id', extra: ['price', 'price_from'] },
  warranties: { table: 'warranties', extra: ['months', 'is_default'] },
  stages: { table: 'stages', extra: ['color', 'sla_hours'] },
};

function dictName(v: string): DictionaryName {
  if (!(DICTIONARIES as readonly string[]).includes(v)) throw new HttpError(404, 'Нет такого справочника');
  return v as DictionaryName;
}

function columnsFor(name: DictionaryName, input: ReturnType<typeof dictionaryItemSchema.parse>) {
  const t = TABLES[name];
  const cols: Record<string, unknown> = { name: input.name };
  if (input.sort !== undefined) cols.sort = input.sort;
  if (input.isActive !== undefined) cols.is_active = input.isActive;
  if (t.parent && input.parentId !== undefined) cols[t.parent] = input.parentId;
  if (t.extra?.includes('price') && input.price !== undefined) cols.price = input.price ?? 0;
  if (t.extra?.includes('price_from') && input.priceFrom !== undefined) cols.price_from = input.priceFrom;
  if (t.extra?.includes('months') && input.months !== undefined) cols.months = input.months;
  if (t.extra?.includes('is_default') && input.isDefault !== undefined) cols.is_default = input.isDefault;
  if (t.extra?.includes('color') && input.color !== undefined) cols.color = input.color;
  if (t.extra?.includes('sla_hours') && input.slaHours !== undefined) cols.sla_hours = input.slaHours;
  return cols;
}

dictionariesRouter.post(
  '/dictionaries/:name',
  requirePermission('dictionaries.edit'),
  h(async (req, res) => {
    const name = dictName(req.params.name);
    const input = parse(dictionaryItemSchema, req.body);
    const t = TABLES[name];
    if ((name === 'brands' || name === 'models') && !input.parentId) {
      throw new HttpError(400, name === 'brands' ? 'Выберите тип техники' : 'Выберите марку');
    }
    const cols = columnsFor(name, input);
    if (name === 'appearance' || name === 'kit' || name === 'inspect_pc' || name === 'inspect_printer') cols.kind = name;
    if (name === 'visit_works') cols.kind = 'visit';
    if (name === 'warranties' && cols.months === undefined) throw new HttpError(400, 'Укажите срок в месяцах');
    if (name === 'stages') {
      cols.code = `stage_${Date.now().toString(36)}`;
      // Новый этап встаёт перед финальным, если порядок не указан.
      if (cols.sort === undefined) {
        const last = await one<{ s: number }>(`SELECT max(sort) AS s FROM stages WHERE NOT is_final`);
        cols.sort = (last?.s ?? 0) + 5;
      }
    }
    if (cols.sort === undefined) {
      const max = await one<{ s: number }>(`SELECT coalesce(max(sort), 0) AS s FROM ${t.table}`);
      cols.sort = (max?.s ?? 0) + 10;
    }
    const keys = Object.keys(cols);
    const row = await one(
      `INSERT INTO ${t.table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(cols),
    );
    if (name === 'warranties' && cols.is_default) {
      await pool.query('UPDATE warranties SET is_default = false WHERE id <> $1', [row.id]);
    }
    broadcast('changed', { scopes: ['dictionaries'] });
    res.status(201).json({ id: row.id });
  }),
);

dictionariesRouter.put(
  '/dictionaries/:name/:id',
  requirePermission('dictionaries.edit'),
  h(async (req, res) => {
    const name = dictName(req.params.name);
    const id = intParam(req.params.id);
    const input = parse(dictionaryItemSchema, req.body);
    const t = TABLES[name];
    const cols = columnsFor(name, input);
    if (name === 'stages' && input.isActive === false) {
      const s = await one<{ is_final: boolean; sort: number }>('SELECT is_final, sort FROM stages WHERE id = $1', [id]);
      const first = await one<{ id: number }>('SELECT id FROM stages WHERE is_active ORDER BY sort, id LIMIT 1');
      if (s?.is_final || first?.id === id) throw new HttpError(400, 'Первый и последний этапы отключать нельзя');
      const used = await one('SELECT 1 FROM orders WHERE stage_id = $1 LIMIT 1', [id]);
      if (used) throw new HttpError(409, 'На этом этапе есть заявки. Сначала переведите их дальше.');
    }
    const keys = Object.keys(cols);
    const r = await pool.query(
      `UPDATE ${t.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1${t.where ? ` AND ${t.where}` : ''}`,
      [id, ...Object.values(cols)],
    );
    if (!r.rowCount) throw new HttpError(404, 'Запись не найдена');
    if (name === 'warranties' && cols.is_default) {
      await pool.query('UPDATE warranties SET is_default = false WHERE id <> $1', [id]);
    }
    broadcast('changed', { scopes: ['dictionaries'] });
    res.json({ ok: true });
  }),
);

dictionariesRouter.get(
  '/settings',
  h(async (_req, res) => {
    res.json({ company: await getCompanySettings(), work: await getWorkSettings() });
  }),
);

dictionariesRouter.put(
  '/settings/company',
  requirePermission('settings.edit'),
  h(async (req, res) => {
    const v = parse(companySettingsSchema, req.body);
    await setSetting('company', v);
    res.json(v);
  }),
);

dictionariesRouter.put(
  '/settings/work',
  requirePermission('settings.edit'),
  h(async (req, res) => {
    const v = parse(workSettingsSchema, req.body);
    await setSetting('work', v);
    res.json(v);
  }),
);
