import request from 'supertest';
import { createApp } from '../src/app';
import { pool, tx } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { createUsers, seedReference } from '../src/db/seed';
import { _resetAllForTests } from '../src/auth/rateLimit';
import { config } from '../src/config';

export const PASSWORD = 'test-password-123';
export const app = createApp();

/** Чистая тестовая база: схема, справочники, пять сотрудников. */
export async function resetDb() {
  if (!/test/.test(config.databaseUrl)) throw new Error('Тесты запускаются только на базе с «test» в имени');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(false);
  await tx((db) => seedReference(db));
  await createUsers(PASSWORD);
  _resetAllForTests();
}

export interface Session {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
  user: { id: number; role: string };
}

/** Вход под сотрудником. Запросы идут с cookie сессии и CSRF-токеном. */
export async function loginAs(login: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ login, password: PASSWORD, remember: false });
  if (res.status !== 200) throw new Error(`Не вошли как ${login}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken as string;
  return {
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    put: (url, body = {}) => agent.put(url).set('X-CSRF-Token', csrf).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrf),
    user: res.body.user,
  };
}

export async function dict() {
  const r = await pool.query(`SELECT id, code FROM stages ORDER BY sort`);
  const stage = Object.fromEntries(r.rows.map((s) => [s.code, s.id as number]));
  const laptop = (await pool.query(`SELECT id FROM device_types WHERE name = 'Ноутбук'`)).rows[0].id as number;
  const users = Object.fromEntries((await pool.query('SELECT id, login FROM users')).rows.map((u) => [u.login, u.id as number]));
  return { stage, laptop, users };
}

export const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
};

/** Приём одного ноутбука от нового физлица. Возвращает id заявки. */
export async function intakeLaptop(s: Session, responsibleId: number, phone = '+7 900 000-00-01') {
  const { laptop } = await dict();
  const res = await s.post('/api/intake', {
    clientKind: 'person',
    newClient: { kind: 'person', name: 'Тестовый Клиент', phone },
    devices: [
      {
        device: { deviceTypeId: laptop, brandText: 'Acer', modelText: 'Aspire 5', serial: 'SN1' },
        faultText: 'Не включается',
        appearance: ['Царапины'],
        kit: ['С ЗУ'],
      },
    ],
    responsibleId,
    dueAt: inDays(1),
  });
  if (res.status !== 201) throw new Error(`Приём не прошёл: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.orderIds[0] as number;
}
