// @ts-nocheck
// Демо-режим: серверный код работает прямо в браузере поверх Postgres в WebAssembly.
import './polyfills';
import { Router, dispatch } from 'express';
import { createUsers, seedCustomers, seedDemo, seedReference } from '../../../server/src/db/seed';
import { migrate } from '../../../server/src/db/migrate';
import { one, tx } from '../../../server/src/db/pool';
import { errorHandler } from '../../../server/src/lib/http';
import { csrfProtection, denyCustomer, limitAssistant, loadSession, requireAuth } from '../../../server/src/auth/session';
import { authRouter } from '../../../server/src/routes/auth';
import { dictionariesRouter } from '../../../server/src/routes/dictionaries';
import { usersRouter } from '../../../server/src/routes/users';
import { clientsRouter } from '../../../server/src/routes/clients';
import { ordersRouter } from '../../../server/src/routes/orders';
import { tasksRouter } from '../../../server/src/routes/tasks';
import { notificationsRouter } from '../../../server/src/routes/notifications';
import { actsRouter } from '../../../server/src/routes/acts';
import { documentsRouter } from '../../../server/src/routes/documents';
import { filesRouter } from '../../../server/src/routes/files';
import { importRouter } from '../../../server/src/routes/import';
import { customerRouter } from '../../../server/src/routes/customer';
import { customersRouter } from '../../../server/src/routes/customers';
import { resetDb } from './pg-shim';

export const DEMO_PASSWORD = 'demo';

const app: any = Router();
app.use(loadSession);
const api: any = Router();
api.use(csrfProtection);
api.use('/auth', authRouter);
api.use(requireAuth);
api.use(customerRouter);
api.use(denyCustomer);
api.use(limitAssistant);
for (const r of [
  customersRouter,
  dictionariesRouter,
  usersRouter,
  clientsRouter,
  ordersRouter,
  tasksRouter,
  notificationsRouter,
  actsRouter,
  documentsRouter,
  filesRouter,
  importRouter,
]) {
  api.use(r);
}
app.use('/api', api);

let ready: Promise<void> | null = null;

/** Создаёт таблицы и демо-данные при первом запуске в этом браузере. */
export function bootDemo() {
  ready ??= (async () => {
    await migrate();
    await tx((db) => seedReference(db));
    const users = await one<{ n: number }>('SELECT count(*) AS n FROM users');
    if (!users?.n) {
      await createUsers(DEMO_PASSWORD);
      await seedDemo();
    } else {
      // демо-базы, созданные раньше, получают новых сотрудников (существующих не трогаем)
      await createUsers(DEMO_PASSWORD);
    }
    // демо-базы, созданные до появления заказчиков, тоже получают демо-заказчиков
    await seedCustomers();
  })();
  return ready;
}

export async function demoRequest<T>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
  await bootDemo();
  const clone = body === undefined || body instanceof FormData ? undefined : JSON.parse(JSON.stringify(body));
  const r = await dispatch(app, errorHandler as any, { method, url: `/api${url}`, body: clone });
  const data = r.data instanceof Uint8Array ? r.data : r.data === undefined ? {} : JSON.parse(JSON.stringify(r.data));
  return { status: r.status, data: data as T };
}

/** Стирает данные этого браузера и начинает с чистой демо-базы. */
export async function resetDemo() {
  try {
    sessionStorage.clear();
    localStorage.removeItem('asoft-demo-user');
  } catch {
    /* хранилище закрыто */
  }
  await resetDb();
  location.assign('/');
}

/** PDF открываем в новой вкладке: ссылки на /api/documents обрабатываем сами. */
export function installPdfLinks() {
  document.addEventListener('click', async (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="/api/documents/"]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const win = window.open('', '_blank');
    const url = a.getAttribute('href')!.replace(/^\/api/, '');
    const r = await demoRequest<Uint8Array>('GET', url);
    if (r.status !== 200 || !(r.data instanceof Uint8Array)) {
      win?.close();
      return;
    }
    const blob = new Blob([r.data as BlobPart], { type: 'application/pdf' });
    const href = URL.createObjectURL(blob);
    if (win) win.location.href = href;
    else window.location.href = href;
  });
}

export { demoEvents } from '../../../server/src/notify/hub';
