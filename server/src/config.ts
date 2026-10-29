import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function bool(v: string | undefined, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

// «Сегодня», конец рабочего дня и сроки считаем в часовом поясе сервис-центра.
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Yekaterinburg';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5179,http://127.0.0.1:5179')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Адрес сайта для ссылок в Telegram/Max. Если PUBLIC_URL не задан, берём первый настоящий адрес из ALLOWED_ORIGINS:
 * иначе ссылка вела бы на localhost, который у сотрудника на телефоне не открывается.
 */
export const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u);
const publicUrl = (
  process.env.PUBLIC_URL?.trim() ||
  allowedOrigins.find((o) => !isLocalUrl(o)) ||
  'http://localhost:5179'
).replace(/\/+$/, '');

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest,
  // API_PORT, а не PORT: PORT часто выставляют для фронтенда (превью, хостинги).
  port: Number(process.env.API_PORT || 8431),
  appName: process.env.APP_NAME || 'ASOFT Сервис',
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/servicedesk_test'
    : process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/servicedesk',
  /** Разрешённые Origin для изменяющих запросов (через запятую). */
  allowedOrigins,
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  rememberDays: Number(process.env.REMEMBER_DAYS || 30),
  uploadDir: path.resolve(ROOT_DIR, process.env.UPLOAD_DIR || 'uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 15),
  publicUrl,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  maxBotToken: process.env.MAX_BOT_TOKEN || '',
  maxApiUrl: process.env.MAX_API_URL || 'https://platform-api.max.ru',
  timezone: process.env.APP_TIMEZONE || 'Asia/Yekaterinburg',
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  /**
   * Каким прокси доверяем при определении IP клиента. По умолчанию только своему компьютеру (разработка).
   * В Docker перед приложением стоит один прокси (Angie), там TRUST_PROXY=1. Число считает прокси от приложения.
   */
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY || 'loopback',
};
