import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { can } from '@sd/shared';
import { pool } from '../src/db/pool';
import { app, dict, intakeLaptop, loginAs, PASSWORD, resetDb, type Session } from './helpers';

const register = (login: string, phone: string, extra: object = {}) =>
  request(app).post('/api/auth/register').send({
    kind: 'person',
    fullName: `Заказчик ${login}`,
    phone,
    login,
    password: PASSWORD,
    ...extra,
  });

/** Регистрация + подтверждение руководителем. */
async function onboard(manager: Session, login: string, phone: string) {
  const reg = await register(login, phone);
  expect(reg.status).toBe(201);
  const list = await manager.get('/api/customers');
  const row = list.body.find((c: { login: string }) => c.login === login);
  const ok = await manager.post(`/api/customers/${row.id}/approve`);
  expect(ok.status).toBe(200);
  return { id: row.id as number, clientId: ok.body.clientId as number };
}

describe('матрица прав заказчика', () => {
  it('заказчик не получает рабочих прав', () => {
    for (const p of ['intake.create', 'clients.edit', 'tasks.create', 'tasks.manageAll', 'acts.edit', 'users.manage', 'settings.edit'] as const) {
      expect(can('customer', p)).toBe(false);
    }
    expect(can('manager', 'customers.manage')).toBe(true);
    expect(can('master', 'customers.manage')).toBe(false);
  });
});

describe('кабинет заказчика по API', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('регистрация ждёт подтверждения: войти нельзя, логин занят', async () => {
    const reg = await register('anna', '+7 900 111-22-33');
    expect(reg.status).toBe(201);
    const dup = await register('ANNA', '+7 900 111-22-34');
    expect(dup.status).toBe(409);
    const login = await request(app).post('/api/auth/login').send({ login: 'anna', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('pending');
  });

  it('руководитель получает уведомление о регистрации и подтверждает: создаётся карточка клиента', async () => {
    const semen = await loginAs('semen');
    const note = await semen.get('/api/notifications');
    expect(note.body.items.some((n: { type: string }) => n.type === 'customer_registered')).toBe(true);

    const list = await semen.get('/api/customers');
    const anna = list.body.find((c: { login: string }) => c.login === 'anna');
    expect(anna.pending).toBe(true);
    const ok = await semen.post(`/api/customers/${anna.id}/approve`);
    expect(ok.status).toBe(200);
    const client = await pool.query('SELECT name, phone_digits FROM clients WHERE id = $1', [ok.body.clientId]);
    expect(client.rows[0].name).toBe('Заказчик anna');

    const again = await semen.post(`/api/customers/${anna.id}/approve`);
    expect(again.status).toBe(409);

    const anna1 = await loginAs('anna');
    expect(anna1.user.role).toBe('customer');
  });

  it('подтверждение привязывает кабинет к уже существующему клиенту по телефону', async () => {
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, (await dict()).users.olga, '+7 922 333-44-55');
    const existing = await pool.query('SELECT client_id FROM orders WHERE id = $1', [orderId]);
    const { clientId } = await onboard(semen, 'petr', '8 (922) 333-44-55');
    expect(clientId).toBe(existing.rows[0].client_id);

    const petr = await loginAs('petr');
    const orders = await petr.get('/api/customer/orders');
    expect(orders.status).toBe(200);
    expect(orders.body).toHaveLength(1);
    // только то, что нужно заказчику
    expect(Object.keys(orders.body[0]).sort()).toEqual(
      ['createdAt', 'deviceTitle', 'id', 'isFinal', 'issuedAt', 'number', 'stageCode', 'stageColor', 'stageName'].sort(),
    );
  });

  it('заказчик ставит задачу: она уходит руководителю с пометкой, видна только автору', async () => {
    const semen = await loginAs('semen');
    const anna = await loginAs('anna');
    const create = await anna.post('/api/customer/tasks', { title: 'Заправить картриджи', description: '5 штук' });
    expect(create.status).toBe(201);

    const mine = await anna.get('/api/customer/tasks');
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ title: 'Заправить картриджи', status: 'open', assigneeName: expect.any(String) });

    const staff = await semen.get('/api/tasks?scope=mine&status=open');
    const t = staff.body.find((x: { title: string }) => x.title === 'Заправить картриджи');
    expect(t.fromCustomer).toBe(true);
    expect(t.assigneeId).toBe(semen.user.id);

    const note = await semen.get('/api/notifications');
    expect(note.body.items.some((n: { title: string }) => n.title.includes('Заправить картриджи'))).toBe(true);

    // другой заказчик не видит чужое и не может это отменить
    const petr = await loginAs('petr');
    expect((await petr.get('/api/customer/tasks')).body).toHaveLength(0);
    expect((await petr.post(`/api/customer/tasks/${create.body.id}/cancel`)).status).toBe(404);
  });

  it('руководитель закрывает задачу с комментарием — заказчик видит результат и получает уведомление', async () => {
    const semen = await loginAs('semen');
    const anna = await loginAs('anna');
    const open = (await anna.get('/api/customer/tasks')).body[0];
    const closed = await semen.post('/api/tasks/close', { ids: [open.id], comment: 'Заправили, забирайте' });
    expect(closed.status).toBe(200);
    const mine = (await anna.get('/api/customer/tasks')).body[0];
    expect(mine).toMatchObject({ status: 'done', closeComment: 'Заправили, забирайте' });
    const note = await anna.get('/api/notifications');
    expect(note.body.items.some((n: { type: string }) => n.type === 'task_closed')).toBe(true);
  });

  it('заказчик отменяет свою открытую задачу, исполнитель получает уведомление', async () => {
    const semen = await loginAs('semen');
    const anna = await loginAs('anna');
    const t = await anna.post('/api/customer/tasks', { title: 'Передумал' });
    const res = await anna.post(`/api/customer/tasks/${t.body.id}/cancel`);
    expect(res.status).toBe(200);
    expect((await anna.post(`/api/customer/tasks/${t.body.id}/cancel`)).status).toBe(409);
    const note = await semen.get('/api/notifications');
    expect(note.body.items.some((n: { type: string }) => n.type === 'task_cancelled')).toBe(true);
  });

  it('всё рабочее заказчику закрыто', async () => {
    const anna = await loginAs('anna');
    for (const url of [
      '/api/orders',
      '/api/clients',
      '/api/users',
      '/api/tasks',
      '/api/dashboard',
      '/api/acts',
      '/api/dictionaries',
      '/api/settings/work',
      '/api/customers',
      '/api/orders/1',
      '/api/clients/1',
    ]) {
      const res = await anna.get(url);
      expect(res.status, url).toBe(403);
    }
    expect((await anna.post('/api/tasks', { title: 'x', assigneeId: 1 })).status).toBe(403);
    expect((await anna.post('/api/intake', {})).status).toBe(403);
    expect((await anna.post('/api/customers/1/approve')).status).toBe(403);
    // а своё открыто
    expect((await anna.get('/api/auth/me')).status).toBe(200);
    expect((await anna.get('/api/notifications')).status).toBe(200);
    expect((await anna.get('/api/customer/tasks')).status).toBe(200);
  });

  it('сотруднику чужой кабинет закрыт, а заказчики не попадают в списки сотрудников', async () => {
    const stas = await loginAs('stas');
    expect((await stas.get('/api/customer/tasks')).status).toBe(403);
    expect((await stas.get('/api/customers')).status).toBe(403);

    const admin = await loginAs('admin');
    const users = await admin.get('/api/users');
    expect(users.body.some((u: { role: string }) => u.role === 'customer')).toBe(false);

    // заказчика нельзя назначить исполнителем и нельзя править как сотрудника
    const anna = (await pool.query(`SELECT id FROM users WHERE login = 'anna'`)).rows[0].id as number;
    const semen = await loginAs('semen');
    const bad = await semen.post('/api/tasks', {
      title: 'Тест',
      assigneeId: anna,
      startAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    expect(bad.status).toBe(400);
    expect((await admin.put(`/api/users/${anna}`, { isActive: false })).status).toBe(404);
    // и создать пользователя-заказчика через «Сотрудников» нельзя
    const made = await admin.post('/api/users', { login: 'hack', fullName: 'Хакер', role: 'customer', password: 'password-123' });
    expect(made.status).toBe(400);
  });

  it('отклонение удаляет заявку, закрытие доступа выбрасывает заказчика', async () => {
    const semen = await loginAs('semen');
    await register('bob', '+7 900 777-88-99');
    const list = await semen.get('/api/customers');
    const bob = list.body.find((c: { login: string }) => c.login === 'bob');
    expect((await semen.post(`/api/customers/${bob.id}/reject`)).status).toBe(200);
    expect((await semen.post(`/api/customers/${bob.id}/reject`)).status).toBe(404);

    const anna = await loginAs('anna');
    const annaRow = (await semen.get('/api/customers')).body.find((c: { login: string }) => c.login === 'anna');
    expect((await semen.put(`/api/customers/${annaRow.id}`, { isActive: false })).status).toBe(200);
    expect((await anna.get('/api/customer/tasks')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ login: 'anna', password: PASSWORD })).status).toBe(401);
  });
});
