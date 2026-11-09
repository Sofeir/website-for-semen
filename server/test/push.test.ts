import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

const sub = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});

describe('уведомления на устройство (Web Push)', () => {
  it('ключ выдаётся и не меняется; устройство подписывается и отписывается', async () => {
    const semen = await loginAs('semen');
    const k1 = (await semen.get('/api/push/key')).body.publicKey as string;
    expect(k1.length).toBeGreaterThan(40);
    expect((await semen.get('/api/push/key')).body.publicKey).toBe(k1);

    expect((await semen.post('/api/push/subscribe', sub(1))).status).toBe(200);
    expect((await semen.post('/api/push/subscribe', sub(1))).status).toBe(200); // повтор не плодит записей
    expect((await pool.query('SELECT 1 FROM push_subscriptions')).rowCount).toBe(1);
    expect((await semen.post('/api/push/subscribe', { endpoint: 'не адрес', keys: {} })).status).toBe(400);
    // чужие адреса не принимаем: сервер не должен ходить куда попало
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:8443/x']) {
      expect((await semen.post('/api/push/subscribe', { ...sub(1), endpoint })).status).toBe(400);
    }

    // устройство перешло к другому сотруднику: подписка теперь его, у Семёна её нет
    const stas = await loginAs('isakov');
    expect((await stas.post('/api/push/subscribe', sub(1))).status).toBe(200);
    expect((await pool.query(`SELECT u.login FROM push_subscriptions p JOIN users u ON u.id = p.user_id`)).rows).toEqual([{ login: 'isakov' }]);

    // чужую подписку отписать нельзя
    await semen.post('/api/push/unsubscribe', { endpoint: sub(1).endpoint });
    expect((await pool.query('SELECT 1 FROM push_subscriptions')).rowCount).toBe(1);
    await stas.post('/api/push/unsubscribe', { endpoint: sub(1).endpoint });
    expect((await pool.query('SELECT 1 FROM push_subscriptions')).rowCount).toBe(0);
  });
});
