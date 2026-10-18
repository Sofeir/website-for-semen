import fs from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const PASSWORD = process.env.E2E_PASSWORD || env.SEED_PASSWORD;

// Сценарии длинные и меняют общие данные — гоняем только в десктопном проекте и по очереди.
test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'полные сценарии проверяем на десктопе');

async function as(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
  });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  return page;
}

async function advance(page: Page, orderUrl: string, buttonName: RegExp, responsible?: string) {
  await page.goto(orderUrl);
  await page.getByRole('button', { name: buttonName }).click();
  const dialog = page.getByRole('dialog');
  if (responsible) await dialog.locator('select').first().selectOption({ label: responsible });
  await dialog.getByRole('button', { name: /^(Перевести|Выдать)$/ }).click();
  await expect(dialog).toBeHidden();
}

test('ремонт: диагностика → согласование → мастер → готово → акт с несколькими работами → выдача', async ({ browser }) => {
  const semen = await as(browser, 'semen');
  // Новая заявка на Стаса, чтобы не зависеть от демо-данных.
  await semen.goto('/intake');
  const suffix = String(Date.now()).slice(-6);
  await semen.getByLabel('Найти клиента').fill(`Ремонт ${suffix}`);
  await semen.getByRole('button', { name: /Новый клиент/ }).click();
  await semen
    .getByRole('textbox', { name: 'Телефон' })
    .fill(`+7 922 ${suffix.slice(0, 3)}-${suffix.slice(3, 5)}-${suffix.slice(4, 6)}`);
  await semen.getByText('Ноутбук', { exact: true }).click();
  await semen.getByText('Перегревается, шумит', { exact: true }).click();
  await semen.getByLabel('Ответственный').selectOption({ label: 'Стас' });
  await semen.getByRole('button', { name: 'Сохранить приём' }).click();
  await semen.getByRole('dialog').getByRole('button', { name: 'Открыть заявку' }).click();
  await expect(semen).toHaveURL(/\/orders\/\d+$/);
  const orderUrl = new URL(semen.url()).pathname;

  const stas = await as(browser, 'stas');
  await advance(stas, orderUrl, /Дальше: Согласование/, 'Семён');
  await advance(semen, orderUrl, /Дальше: Ремонт/, 'Лёня');
  const lenya = await as(browser, 'lenya');
  await advance(lenya, orderUrl, /Дальше: Готово/, 'Семён');

  // Акт: две работы из прайса и одна своя строка.
  await lenya.goto(orderUrl);
  await lenya.getByRole('link', { name: 'Акт работ' }).click();
  await lenya.getByRole('button', { name: /Чистка от пыли с заменой термопасты/ }).click();
  await lenya.getByRole('button', { name: /Прошивка BIOS/ }).click();
  await lenya.getByRole('button', { name: 'Своя строка' }).click();
  await lenya.getByPlaceholder('Что сделали').last().fill('Термопрокладки');
  const prices = lenya.getByRole('textbox', { name: 'Цена, ₽' });
  await prices.last().fill('450');
  await expect(lenya.getByText(/^2\s450\s₽$/).first()).toBeVisible();
  await lenya.getByRole('button', { name: 'Создать акт' }).click();
  await expect(lenya).toHaveURL(/\/acts\/\d+$/);
  const actPdf = await lenya.request.get(new URL(lenya.url()).pathname.replace('/acts/', '/api/documents/act/') + '.pdf');
  expect(actPdf.status()).toBe(200);

  await advance(semen, orderUrl, /Выдать технику/);
  await semen.goto(orderUrl);
  await expect(semen.getByText('Выдано клиенту')).toBeVisible();
});

test('юрлицо: приём двух единиц техники и чек-лист парка по отделам', async ({ browser }) => {
  const semen = await as(browser, 'semen');
  await semen.goto('/intake');
  await semen.getByRole('radio', { name: 'Юрлицо' }).click();
  await semen.getByLabel('Найти клиента').fill('РБЕ');
  await semen.getByRole('button', { name: /ООО «РБЕ Урал»/ }).click();

  // Чек-лист подтянулся из карточки: 60 ПК и 20 МФУ.
  await semen.getByRole('button', { name: /Чек-лист парка техники/ }).click();
  await expect(semen.getByText('60 ПК, 20 МФУ').first()).toBeVisible();
  await semen.getByRole('button', { name: 'Добавить отдел' }).click();
  await semen.getByPlaceholder('Например, бухгалтерия').last().fill('Переговорная');

  await semen.getByRole('radio', { name: 'Принтеры/МФУ' }).first().click();
  await semen.getByText('Не печатает', { exact: true }).first().click();
  await semen.getByRole('button', { name: 'Ещё техника в этот приём' }).click();
  await semen.getByRole('radio', { name: 'Компьютер' }).last().click();
  await semen.getByPlaceholder('Со слов клиента: что случилось и когда').last().fill('Шумит вентилятор');
  await semen.getByRole('button', { name: 'Сохранить приём' }).click();

  const dialog = semen.getByRole('dialog', { name: 'Техника принята' });
  await expect(dialog).toContainText('Заявки');
  const href = await dialog.getByRole('link', { name: /Квитанция о приёме/ }).getAttribute('href');
  expect((await semen.request.get(href!)).status()).toBe(200);
  await dialog.getByRole('button', { name: 'Открыть заявку' }).click();
  await semen.getByRole('link', { name: 'ООО «РБЕ Урал»' }).click();
  await semen.getByRole('tab', { name: /Парк техники/ }).click();
  await expect(semen.locator('input[value="Переговорная"]').first()).toBeVisible();
});

test('массовое закрытие задач: постановщик получает уведомление', async ({ browser }) => {
  const semen = await as(browser, 'semen');
  const stamp = String(Date.now()).slice(-5);
  for (const title of [`Проверить склад ${stamp}`, `Заказать термопасту ${stamp}`]) {
    await semen.goto('/tasks');
    await semen.getByRole('button', { name: 'Поставить задачу' }).click();
    const dialog = semen.getByRole('dialog', { name: 'Новая задача' });
    await dialog.getByLabel('Что сделать').fill(title);
    await dialog.getByLabel('Ответственный').selectOption({ label: 'Ольга' });
    await dialog.getByRole('button', { name: 'Поставить задачу' }).click();
    await expect(dialog).toBeHidden();
  }

  const olga = await as(browser, 'olga');
  await olga.goto('/tasks');
  await olga.getByRole('checkbox', { name: `Отметить: Проверить склад ${stamp}` }).click();
  await olga.getByRole('checkbox', { name: `Отметить: Заказать термопасту ${stamp}` }).click();
  await olga.getByRole('button', { name: 'Закрыть выбранные' }).click();
  await olga.getByRole('dialog').getByLabel('Комментарий').fill(`Сделано ${stamp}`);
  await olga.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(olga.getByText('Закрыто: 2 задачи')).toBeVisible();

  await semen.goto('/');
  await semen.getByRole('button', { name: /Уведомления/ }).click();
  await expect(semen.getByText(`Задача закрыта: Проверить склад ${stamp}`)).toBeVisible();
  await expect(semen.getByText(`Комментарий: Сделано ${stamp}`).first()).toBeVisible();
});
