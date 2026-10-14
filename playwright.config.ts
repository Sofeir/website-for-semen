import { defineConfig, devices } from '@playwright/test';

/**
 * E2E на реальном API и базе из .env (демо-данные из npm run db:seed).
 * Браузер — установленный Chrome (PW_CHANNEL=msedge для Edge), отдельно качать Chromium не нужно.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5179',
    channel: process.env.PW_CHANNEL || 'chrome',
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || 'chrome' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5179',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
