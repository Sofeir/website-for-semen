import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const PASSWORD = process.env.E2E_PASSWORD || env.SEED_PASSWORD;

async function login(page: Page, login: string) {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('приём физлица: новый клиент → квитанция PDF → задача и уведомление диагносту', async ({ page, browser }) => {
  const suffix = String(Date.now()).slice(-7);
  const phone = `+7 912 ${suffix.slice(0, 3)}-${suffix.slice(3, 5)}-${suffix.slice(5, 7)}`;
  const name = `Клиент E2E ${suffix}`;

  await login(page, 'semen');
  await page.goto('/intake');
  await expect(page.getByRole('heading', { name: 'Приём техники' })).toBeVisible();

  // Клиента нет в базе — создаём прямо в форме.
  await page.getByLabel('Найти клиента').fill(phone);
  await page.getByRole('button', { name: new RegExp(`Новый клиент`) }).click();
  await page.getByLabel('Имя и фамилия').fill(name);
  await expect(page.getByRole('textbox', { name: 'Телефон' })).toHaveValue(phone);

  // Техника: тип, марка из справочника, модель вручную.
  await page.getByText('Ноутбук', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Марка' }).fill('Len');
  await page.getByRole('button', { name: 'Lenovo' }).click();
  await page.getByRole('combobox', { name: 'Модель' }).fill('IdeaPad 3');
  await page.getByText('Не заряжается', { exact: true }).click();
  await page.getByText('Царапины', { exact: true }).click();
  await page.getByText('С ЗУ', { exact: true }).click();
  await page.getByLabel('Пароль устройства').fill('0000');

  // Ответственный за диагностику — Стас.
  await page.getByLabel('Ответственный').selectOption({ label: 'Стас' });
  await page.getByRole('button', { name: 'Сохранить приём' }).click();

  const dialog = page.getByRole('dialog', { name: 'Техника принята' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('на диагностике');
  const receiptHref = await dialog.getByRole('link', { name: /Квитанция о приёме/ }).getAttribute('href');
  expect(receiptHref).toMatch(/\/api\/documents\/receipt\/\d+\.pdf/);

  const pdf = await page.request.get(receiptHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Заявка открывается, этап «Диагностика», ответственный Стас, есть задача.
  await dialog.getByRole('button', { name: 'Открыть заявку' }).click();
  await expect(page.getByRole('heading', { name: /Ноутбук Lenovo IdeaPad 3/ })).toBeVisible();
  await expect(page.getByText('Сейчас отвечает')).toBeVisible();
  await expect(page.getByText(/Диагностика: Ноутбук Lenovo IdeaPad 3/).first()).toBeVisible();

  // Стас видит уведомление о задаче.
  const ctx = await browser.newContext();
  const stasPage = await ctx.newPage();
  await login(stasPage, 'stas');
  await stasPage.getByRole('button', { name: /Уведомления/ }).click();
  await expect(stasPage.getByText(/Новая задача: Диагностика: Ноутбук Lenovo IdeaPad 3/).first()).toBeVisible();
  await ctx.close();
});
