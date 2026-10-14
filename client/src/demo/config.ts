// Конфигурация демо-сборки: без файловой системы и без .env.
export const ROOT_DIR = '/';
export const config = {
  env: 'production',
  isProd: true,
  isTest: false,
  port: 0,
  appName: 'ASOFT Сервис',
  databaseUrl: '',
  allowedOrigins: [] as string[],
  cookieSecure: false,
  sessionHours: 12,
  rememberDays: 30,
  uploadDir: '',
  maxUploadMb: 15,
  publicUrl: '',
  telegramBotToken: '',
  maxBotToken: '',
  maxApiUrl: '',
  timezone: 'Asia/Yekaterinburg',
  clientDist: '',
};
