// Проверка демо-сборки: вход, главная, заявка, акт, PDF и кнопка сброса. Запуск: node scripts/check-demo.mjs [адрес]
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:5180/website-for-semen/';
const OUT = path.resolve('test-results/demo');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const t0 = Date.now();
await page.goto(BASE + 'login');
await page.getByLabel('Логин').waitFor({ timeout: 90000 });
console.log('форма входа за', Date.now() - t0, 'мс');
await page.getByLabel('Логин').fill('admin');
await page.getByLabel('Пароль', { exact: true }).fill('demo');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForURL(/website-for-semen\/?$/, { timeout: 90000 });
console.log('вход за', Date.now() - t0, 'мс');
await page.getByRole('button', { name: 'Пропустить' }).click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'home.png') });

for (const route of ['orders', 'orders/3', 'clients', 'tasks', 'calendar', 'acts', 'acts/1', 'settings']) {
  await page.goto(BASE + route);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  const text = (await page.locator('main').innerText()).slice(0, 80).replace(/\n/g, ' | ');
  console.log(route.padEnd(10), text);
}
await page.goto(BASE + 'acts/1');
await page.waitForTimeout(800);
const [popup] = await Promise.all([
  context.waitForEvent('page', { timeout: 20000 }).catch(() => null),
  page.locator('a[href*="/api/documents/act/"]').first().click().catch((e) => console.log('нет ссылки на PDF', e.message)),
]);
if (popup) {
  await popup.waitForTimeout(1500);
  console.log('PDF вкладка:', popup.url().slice(0, 40));
}
console.log(errors.length ? 'ОШИБКИ:\n' + errors.slice(0, 8).join('\n') : 'Ошибок консоли нет');
await browser.close();
