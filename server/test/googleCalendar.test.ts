import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db/pool';
import { _setGoogleKeyForTests, syncGoogleUser } from '../src/services/googleCalendar';
import request from 'supertest';
import { config } from '../src/config';
import { app, dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

interface Call {
  method: string;
  url: string;
  body: any;
}

/** Подменяем сеть: Google «отвечает» сам, а мы записываем, что к нему отправили. */
function fakeGoogle() {
  const calls: Call[] = [];
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any = {}) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      calls.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: `g${++n}` }), { status: 200 });
    }),
  );
  return calls;
}

beforeAll(async () => {
  await resetDb();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  _setGoogleKeyForTests({ client_email: 'sync@test.iam.gserviceaccount.com', private_key: privateKey });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  _setGoogleKeyForTests(null);
  await pool.end();
});

describe('запись в Google Календарь', () => {
  it('задачи и события сотрудника попадают в его календарь, изменения обновляются, закрытое убирается', async () => {
    const { users } = await dict();
    const calls = fakeGoogle();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    await pool.query(`UPDATE users SET google_calendar_id = 'stas@example.com' WHERE id = $1`, [users.isakov]);
    const t = await semen.post('/api/tasks', { title: 'Для календаря', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) });
    await stas.post('/api/calendar-events', { title: 'Совещание', startAt: new Date(Date.now() + 86_400_000).toISOString() });
    await new Promise((r) => setTimeout(r, 50));
    calls.length = 0;

    const first = await syncGoogleUser(users.isakov);
    expect(first).toEqual({ created: 2, updated: 0, removed: 0 });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.body.summary).sort()).toEqual(['Крайний срок: Для календаря', 'Совещание']);
    expect(posts[0].url).toContain(encodeURIComponent('stas@example.com'));
    expect(posts[0].body.reminders.overrides.map((o: any) => o.minutes)).toEqual([1440, 120, 15]);

    // без изменений в Google никто не ходит
    calls.length = 0;
    expect(await syncGoogleUser(users.isakov)).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(calls).toHaveLength(0);

    // сменили напоминания и название события: события обновляются
    await stas.put('/api/me/reminders', { minutes: [30] });
    const eventId = (await stas.get('/api/calendar-events')).body[0].id;
    await stas.put(`/api/calendar-events/${eventId}`, { title: 'Совещание у директора', note: '', startAt: new Date(Date.now() + 86_400_000).toISOString() });
    calls.length = 0;
    const second = await syncGoogleUser(users.isakov);
    expect(second.updated).toBe(2);
    expect(calls.every((c) => c.method === 'PATCH')).toBe(true);

    // задачу закрыли, событие удалили
    await semen.post('/api/tasks/close', { ids: [t.body.id], comment: null });
    await stas.del(`/api/calendar-events/${eventId}`);
    calls.length = 0;
    const last = await syncGoogleUser(users.isakov);
    // событие убрано, закрытая задача остаётся серой отметкой «✓» (как в календаре сервиса)
    expect(last.removed).toBe(1);
    expect(last.updated).toBe(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'PATCH')?.body.summary).toBe('✓ Для календаря');
    expect((await pool.query('SELECT 1 FROM google_events WHERE user_id = $1', [users.isakov])).rowCount).toBe(1);
    const u = (await pool.query('SELECT google_sync_error AS e, google_sync_at AS at FROM users WHERE id = $1', [users.isakov])).rows[0];
    expect(u.e).toBeNull();
    expect(u.at).not.toBeNull();
  });

  it('подключение: без доступа к календарю сотрудник получает понятное сообщение, с доступом календарь подключается', async () => {
    let description = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
        if (String(url).includes('closed')) return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 });
        if (String(url).includes('/events')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        return new Response(JSON.stringify({ description }), { status: 200 });
      }),
    );
    const kataev = await loginAs('kataev');
    const status = (await kataev.get('/api/me/google-calendar')).body;
    expect(status).toMatchObject({ configured: true, serviceEmail: 'sync@test.iam.gserviceaccount.com', calendarId: null });
    const denied = await kataev.put('/api/me/google-calendar', { calendarId: 'closed@example.com' });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toContain('sync@test.iam.gserviceaccount.com');
    expect((await kataev.put('/api/me/google-calendar', { calendarId: 'нет пробелов не бывает' })).status).toBe(400);
    // без кода в описании календарь не принимается: чужой календарь, которым поделились с сервисом, не занять
    const noCode = await kataev.put('/api/me/google-calendar', { calendarId: 'open@example.com' });
    expect(noCode.status).toBe(400);
    expect(noCode.body.error).toContain(status.verifyCode);
    description = `Мой календарь ${status.verifyCode}`;
    const ok = await kataev.put('/api/me/google-calendar', { calendarId: 'open@example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.calendarId).toBe('open@example.com');
    // тот же календарь коллеге не отдаём
    const other = await loginAs('golenkov');
    expect((await other.put('/api/me/google-calendar', { calendarId: 'OPEN@example.com' })).status).toBe(409);
    // у каждого свой код
    expect((await other.get('/api/me/google-calendar')).body.verifyCode).not.toBe(status.verifyCode);
    expect((await kataev.del('/api/me/google-calendar')).body.calendarId).toBeNull();
  });
});

describe('календарь: этап заявки — это заявка', () => {
  it('открытый этап попадает в Google одной записью «Заявка №…», закрытые этапы не попадают', async () => {
    const { users } = await dict();
    const calls = fakeGoogle();
    const semen = await loginAs('semen');
    await pool.query(`UPDATE users SET google_calendar_id = 'kat@example.com' WHERE id = $1`, [users.kataev]);
    const orderId = await intakeLaptop(semen, users.kataev, '+7 900 777-30-01');
    await new Promise((r) => setTimeout(r, 50));
    calls.length = 0;
    await syncGoogleUser(users.kataev);
    const posts = calls.filter((c) => c.method === 'POST');
    const summaries = posts.map((c) => c.body.summary as string);
    expect(summaries.some((x) => /^Заявка №\d+: Ноутбук .*\(Диагностика\)$/.test(x))).toBe(true);
    expect(summaries.some((x) => x.startsWith('Диагностика:'))).toBe(false);
    expect(orderId).toBeGreaterThan(0);
  });
});

describe('вход через Google', () => {
  it('подключение по кнопке: метка одноразовая, токен лежит зашифрованным, записи идут в основной календарь', async () => {
    const { users } = await dict();
    config.googleClientId = 'client-id';
    config.googleClientSecret = 'client-secret';
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'kataev@gmail.com' })).toString('base64url')}.y`;
    const calls: { method: string; url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any = {}) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          const body = new URLSearchParams(String(init.body));
          if (body.get('grant_type') === 'authorization_code') {
            return new Response(JSON.stringify({ refresh_token: 'secret-refresh', id_token: idToken, access_token: 'a1' }), { status: 200 });
          }
          return new Response(JSON.stringify({ access_token: 'user-access', expires_in: 3600 }), { status: 200 });
        }
        calls.push({ method: init.method, url: String(url), auth: init.headers?.Authorization ?? null });
        return new Response(JSON.stringify({ id: 'ev1' }), { status: 200 });
      }),
    );
    const kataev = await loginAs('kataev');
    const connect = await kataev.post('/api/me/google-calendar/connect');
    expect(connect.status).toBe(200);
    const url = new URL(connect.body.url);
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    expect(url.searchParams.get('access_type')).toBe('offline');
    const state = url.searchParams.get('state')!;
    const cookie = (connect.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('sd_google_state='))!.split(';')[0]!;
    expect(cookie).toBe(`sd_google_state=${state}`);

    // чужая или выдуманная метка не подходит
    const bad = await request(app).get('/api/google/callback?code=abc&state=' + 'a'.repeat(48));
    expect(bad.headers.location).toContain('google=expired');
    // верная метка, но из чужого браузера (без cookie этого подключения): не принимается и не сгорает
    const foreign = await request(app).get(`/api/google/callback?code=abc&state=${state}`);
    expect(foreign.headers.location).toContain('google=expired');
    expect((await pool.query('SELECT google_refresh_token AS t FROM users WHERE id = $1', [users.kataev])).rows[0].t).toBeNull();

    const ok = await request(app).get(`/api/google/callback?code=abc&state=${state}`).set('Cookie', cookie);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toContain('/profile?google=connected');
    const row = (await pool.query('SELECT google_refresh_token AS t, google_email AS e, google_oauth_state AS s FROM users WHERE id = $1', [users.kataev])).rows[0];
    expect(row.e).toBe('kataev@gmail.com');
    expect(row.s).toBeNull();
    expect(row.t).toBeTruthy();
    expect(row.t).not.toContain('secret-refresh');
    // запись пошла в основной календарь от имени сотрудника
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/calendars/primary/events') && c.auth === 'Bearer user-access')).toBe(true);

    // метка одноразовая
    expect((await request(app).get(`/api/google/callback?code=abc&state=${state}`).set('Cookie', cookie)).headers.location).toContain('google=expired');

    const st = (await kataev.get('/api/me/google-calendar')).body;
    expect(st).toMatchObject({ oauthConfigured: true, oauthConnected: true, connectedEmail: 'kataev@gmail.com' });
    expect(JSON.stringify(st)).not.toContain('secret-refresh');

    // Google отозвал доступ: подключение сбрасывается, в профиле понятное сообщение
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    _setGoogleKeyForTests(null);
    const semen = await loginAs('semen');
    await semen.post('/api/tasks', { title: 'После отзыва доступа', assigneeId: users.kataev, startAt: new Date().toISOString(), dueAt: inDays(2) });
    await new Promise((r) => setTimeout(r, 50));
    await syncGoogleUser(users.kataev);
    const after = (await pool.query('SELECT google_refresh_token AS t, google_sync_error AS e FROM users WHERE id = $1', [users.kataev])).rows[0];
    expect(after.t).toBeNull();
    expect(after.e).toMatch(/подключите его заново/);

    config.googleClientId = '';
    config.googleClientSecret = '';
  });

  it('без ключей приложения подключиться нельзя и сообщение понятное', async () => {
    config.googleClientId = '';
    config.googleClientSecret = '';
    const golenkov = await loginAs('golenkov');
    const r = await golenkov.post('/api/me/google-calendar/connect');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/ключи приложения Google/);
  });
});
