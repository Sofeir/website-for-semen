import type { CompanySettings, WorkSettings } from '@sd/shared';
import { one, type Db, pool } from '../db/pool';

export const DEFAULT_WORK: WorkSettings = {
  workStart: '10:00',
  workEnd: '19:00',
  workDays: [1, 2, 3, 4, 5],
  defaultDueDays: 1,
};

export const DEFAULT_COMPANY: CompanySettings = {
  name: 'Асофт',
  legalName: '',
  inn: '',
  kpp: '',
  ogrn: '',
  address: 'Екатеринбург',
  phone: '',
  email: '',
  site: '',
  workHours: 'Пн–Пт 10:00–19:00',
  receiptTerms: '',
  actTerms: '',
  repeatDiscountText: '',
};

export async function getSetting<T>(key: string, fallback: T, db: Db = pool): Promise<T> {
  const row = await one<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key], db);
  return row ? { ...fallback, ...row.value } : fallback;
}

export async function setSetting(key: string, value: unknown, db: Db = pool) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export const getWorkSettings = (db: Db = pool) => getSetting<WorkSettings>('work', DEFAULT_WORK, db);
export const getCompanySettings = (db: Db = pool) => getSetting<CompanySettings>('company', DEFAULT_COMPANY, db);
