// Проверка вёрстки: обходит экраны на контрольных ширинах, ищет горизонтальный скролл
// и ошибки в консоли, сохраняет скриншоты в test-results/screens.
// Запуск (dev-сервер должен работать): node scripts/check-layout.mjs [маршрут ...]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5179';
const LOGIN = process.env.CHECK_LOGIN || 'semen';
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve('.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const PASSWORD = process.env.CHECK_PASSWORD || env.SEED_PASSWORD;

const WIDTHS = (process.env.WIDTHS || '360,390,768,1024,1280,1440').split(',').map(Number);
const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/',
      '/orders',
      '/orders?view=list',
      '/orders/3',
      '/intake',
      '/clients',
      '/clients/5',
      '/tasks',
      '/calendar',
      '/acts',
      '/acts/1',
      '/settings',
      '/profile',
    ];
const OUT = path.resolve('test-results/screens');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const problems = [];
for (const width of WIDTHS) {
  const mobile = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Логин').fill(LOGIN);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(`${BASE}/`);
  // Онбординг закрываем, чтобы не мешал снимкам (появляется после загрузки главной).
  await page
    .getByRole('button', { name: 'Пропустить' })
    .click({ timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  for (const route of ROUTES) {
    errors.length = 0;
    await page.goto(`${BASE}${route}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const wide = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > w + 1) {
          // элементы внутри горизонтальных скроллеров (канбан, вкладки) — это норма
          let p = el.parentElement;
          while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            if (/(auto|scroll|hidden)/.test(cs.overflowX)) return;
            p = p.parentElement;
          }
          wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} → ${Math.round(r.right)}`);
        }
      });
      return { scroll: document.documentElement.scrollWidth - w, wide: wide.slice(0, 5) };
    });
    const name = `${String(width).padStart(4, '0')}${route.replace(/[/?=&]+/g, '_') || '_home'}.png`;
    await page.screenshot({ path: path.join(OUT, name), fullPage: true });
    const tag = `${width}px ${route}`;
    if (overflow.scroll > 0 || overflow.wide.length)
      problems.push(`${tag}: горизонтальный скролл ${overflow.scroll}px ${overflow.wide.join('; ')}`);
    const realErrors = errors.filter((e) => !/Download the React DevTools/.test(e));
    if (realErrors.length) problems.push(`${tag}: ошибки консоли: ${realErrors.slice(0, 3).join(' | ')}`);
  }
  await context.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'Проблем не найдено');
console.log(`Скриншоты: ${OUT}`);
