import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { can, PERMISSIONS } from '@sd/shared';
import { pool } from '../src/db/pool';
import { app, dict, inDays, loginAs, PASSWORD, resetDb } from './helpers';

describe('матрица прав', () => {
  it('справочники и сотрудники — директор и руководитель системного администрирования', () => {
    for (const r of ['admin', 'manager'] as const) {
      expect(can(r, 'dictionaries.edit')).toBe(true);
      expect(can(r, 'users.manage')).toBe(true);
    }
    for (const r of ['diagnostician', 'master'] as const) {
      expect(can(r, 'dictionaries.edit')).toBe(false);
      expect(can(r, 'users.manage')).toBe(false);
    }
    expect(PERMISSIONS['intake.create']).toEqual(['admin', 'manager']);
  });
});

describe('права на уровне API', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('без входа — 401', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });

  it('изменяющий запрос без CSRF-токена отклоняется', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ login: 'semen', password: PASSWORD });
    const res = await agent.post('/api/tasks').send({});
    expect(res.status).toBe(403);
  });

  it('чужой Origin отклоняется', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ login: 'semen', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('диагност не может принимать технику и править справочники', async () => {
    const stas = await loginAs('stas');
    const { laptop, users } = await dict();
    const intake = await stas.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Кто-то', phone: '+79000000099' },
      devices: [{ device: { deviceTypeId: laptop }, faultText: 'x' }],
      responsibleId: users.stas,
      dueAt: inDays(1),
    });
    expect(intake.status).toBe(403);
    expect((await stas.post('/api/dictionaries/device_types', { name: 'Дрон' })).status).toBe(403);
    expect((await stas.put('/api/settings/company', { name: 'X' })).status).toBe(403);
    expect((await stas.post('/api/users', {})).status).toBe(403);
  });

  it('инженер справочники не правит, директор и руководитель системного администрирования правят', async () => {
    const stas = await loginAs('stas');
    expect((await stas.post('/api/dictionaries/device_types', { name: 'Дрон' })).status).toBe(403);
    const admin = await loginAs('admin');
    expect((await admin.post('/api/dictionaries/device_types', { name: 'Дрон' })).status).toBe(201);
    const semen = await loginAs('semen');
    expect((await semen.post('/api/dictionaries/device_types', { name: 'Квадрокоптер' })).status).toBe(201);
  });

  it('мастер не видит логины коллег, администратор видит', async () => {
    const lenya = await loginAs('lenya');
    const admin = await loginAs('admin');
    expect((await lenya.get('/api/users')).body[0].login).toBeUndefined();
    expect((await admin.get('/api/users')).body[0].login).toBeDefined();
  });

  it('импорт из Excel — только директор и руководитель системного администрирования', async () => {
    const stas = await loginAs('stas');
    expect((await stas.post('/api/import/commit', { token: 'x'.repeat(20), kind: 'person', mapping: { name: 0 } })).status).toBe(403);
    expect((await stas.post('/api/import/preview')).status).toBe(403);
    for (const login of ['admin', 'semen']) {
      const boss = await loginAs(login);
      expect((await boss.post('/api/import/commit', { token: 'x'.repeat(20), kind: 'person', mapping: { name: 0 } })).status).toBe(410);
    }
  });

  it('сотрудник: телефон обязателен, почта проверяется и сохраняется', async () => {
    const boss = await loginAs('semen');
    const base = { login: 'newbie', fullName: 'Новый Сотрудник', role: 'master', password: 'long-password-1' };
    expect((await boss.post('/api/users', base)).status).toBe(400);
    expect((await boss.post('/api/users', { ...base, phone: '+7 900 111-22-33', email: 'не-почта' })).status).toBe(400);
    const ok = await boss.post('/api/users', { ...base, phone: '+7 900 111-22-33', email: 'new@example.ru' });
    expect(ok.status).toBe(201);
    const list = (await boss.get('/api/users')).body;
    expect(list.find((u: any) => u.login === 'newbie')).toMatchObject({ phone: '+7 900 111-22-33', email: 'new@example.ru' });
    const upd = await boss.put(`/api/users/${ok.body.id}`, { email: 'other@example.ru' });
    expect(upd.status).toBe(200);
  });

  it('после пяти неверных паролей вход блокируется', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ login: 'olga', password: 'wrong' });
    }
    const res = await request(app).post('/api/auth/login').send({ login: 'olga', password: PASSWORD });
    expect(res.status).toBe(429);
  });
});
