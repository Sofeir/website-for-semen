import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../src/db/pool';
import { app } from './helpers';
import { loginDelayMs, loginRetryAfter, registerLoginFail, _resetAllForTests } from '../src/auth/rateLimit';
import { createLimiter } from '../src/lib/requestLimit';
import { config } from '../src/config';
import { weakPasswordReason } from '@sd/shared';
import { PASSWORD, dict, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('ограничитель частоты запросов', () => {
  it('пропускает до лимита, потом просит подождать, у каждого ключа свой счёт', () => {
    const l = createLimiter({ windowMs: 60_000, max: 3 });
    expect([l.take('a'), l.take('a'), l.take('a')]).toEqual([0, 0, 0]);
    expect(l.take('a')).toBeGreaterThan(0);
    expect(l.take('b')).toBe(0);
  });

  it('перебор одного логина с разных адресов замедляется, но настоящего владельца не запирает', () => {
    _resetAllForTests();
    for (let i = 0; i < 60; i++) registerLoginFail(`10.0.0.${i}`, 'semen');
    expect(loginDelayMs('semen')).toBeGreaterThan(0);
    expect(loginRetryAfter('10.9.9.9', 'semen')).toBe(0); // вход не закрыт
    expect(loginDelayMs('kataev')).toBe(0);
    _resetAllForTests();
  });
});

describe('пароли', () => {
  it('очевидные пароли отклоняются при смене и регистрации', () => {
    expect(weakPasswordReason('12345678')).not.toBeNull();
    expect(weakPasswordReason('qwerty123')).not.toBeNull();
    expect(weakPasswordReason('aaaaaaaaaa')).not.toBeNull();
    expect(weakPasswordReason('87654321x', 'x')).toBeNull();
    expect(weakPasswordReason('semen-2026-ok', 'semen')).not.toBeNull();
    expect(weakPasswordReason('Каменный-луг-77')).toBeNull();
  });

  it('смена пароля на простой не проходит, на нормальный проходит', async () => {
    const stas = await loginAs('isakov');
    expect((await stas.post('/api/auth/me/password', { current: PASSWORD, next: '12345678' })).status).toBe(400);
    expect((await stas.post('/api/auth/me/password', { current: PASSWORD, next: 'isakov-secret-9' })).status).toBe(400); // в пароле логин
    expect((await stas.post('/api/auth/me/password', { current: PASSWORD, next: 'Каменный-луг-77' })).status).toBe(200);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE login = 'isakov'`, [bcrypt.hashSync(PASSWORD, 10)]);
  });

  it('слабая регистрация заказчика отклоняется', async () => {
    const res = await request(app).post('/api/auth/register').send({
      kind: 'person', fullName: 'Иван Тестов', contactPerson: null, phone: '+7 900 000-00-77', email: null, login: 'ivan.t', password: 'password1',
    });
    expect(res.status).toBe(400);
  });

  it('с одного телефона в очереди не больше двух заявок на регистрацию', async () => {
    const reg = (login: string) =>
      request(app).post('/api/auth/register').send({
        kind: 'person', fullName: 'Пётр Очередной', contactPerson: null, phone: '+7 900 555-12-34', email: null, login, password: 'Каменный-луг-77',
      });
    expect((await reg('queue.one')).status).toBe(201);
    expect((await reg('queue.two')).status).toBe(201);
    expect((await reg('queue.three')).status).toBe(409);
  });

  it('при входе старый слабый хеш пересчитывается по текущей стоимости', async () => {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE login = 'kataev'`, [bcrypt.hashSync(PASSWORD, 4)]);
    await loginAs('kataev');
    const hash = (await pool.query(`SELECT password_hash FROM users WHERE login = 'kataev'`)).rows[0].password_hash as string;
    expect(bcrypt.getRounds(hash)).toBe(config.bcryptRounds);
  });
});

describe('сессии и заголовки', () => {
  it('у человека не больше 15 одновременных входов', async () => {
    for (let i = 0; i < 18; i++) await loginAs('maria');
    const n = (await pool.query(`SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.login = 'maria'`)).rows[0].n;
    expect(n).toBeLessThanOrEqual(15);
  });

  it('ответы API не кэшируются, запрещены лишние возможности устройства', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['permissions-policy']).toContain('microphone=()');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('загрузка файлов', () => {
  it('в чужую заявку файл прикрепить нельзя', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const forStas = await intakeLaptop(semen, users.isakov, '+7 900 222-00-01');
    const olga = await loginAs('maria');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const res = await olga.upload('/api/uploads', { name: 'a.png', type: 'image/png', data: png }, { orderId: String(forStas) });
    expect(res.status).toBe(403);
    const own = await semen.upload('/api/uploads', { name: 'a.png', type: 'image/png', data: png }, { orderId: String(forStas) });
    expect(own.status).toBe(201);
  });
});
