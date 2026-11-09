import { Router } from 'express';
import { z } from 'zod';
import { one, pool } from '../db/pool';
import { h, parse } from '../lib/http';
import { pushPublicKey, sendPush } from '../notify/push';

export const pushRouter = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(10).max(100) }),
});

pushRouter.get(
  '/push/key',
  h(async (_req, res) => {
    res.json({ publicKey: await pushPublicKey() });
  }),
);

/** Устройство включает уведомления. Один и тот же адрес устройства может перейти к другому человеку (вошёл под другим логином). */
pushRouter.post(
  '/push/subscribe',
  h(async (req, res) => {
    const input = parse(subscribeSchema, req.body);
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [req.user!.id, input.endpoint, input.keys.p256dh, input.keys.auth, String(req.headers['user-agent'] ?? '').slice(0, 300)],
    );
    res.json({ ok: true });
  }),
);

pushRouter.post(
  '/push/unsubscribe',
  h(async (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user!.id]);
    res.json({ ok: true });
  }),
);

/** Пробное уведомление себе: проверить, что устройство его получает. */
pushRouter.post(
  '/push/test',
  h(async (req, res) => {
    const devices = await one<{ n: number }>('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [req.user!.id]);
    const sent = await sendPush(req.user!.id, {
      title: 'Проверка уведомлений',
      body: 'Если вы видите это окно, уведомления на этом устройстве работают.',
      url: '/',
      tag: 'push-test',
    });
    res.json({ devices: devices?.n ?? 0, sent });
  }),
);
