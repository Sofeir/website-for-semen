import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { pool } from '../src/db/pool';
import { _resetBotNameForTests } from '../src/notify/maxLink';
import { processUpdate, badCodeText } from '../src/notify/maxBot';
import { loginAs, resetDb } from './helpers';

describe('подключение Max одной кнопкой', () => {
  const old = config.maxBotToken;
  beforeAll(resetDb);
  afterAll(() => pool.end());
  beforeEach(() => {
    config.maxBotToken = 'test-token';
    _resetBotNameForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ username: 'service_bot' }) }),
    );
  });
  afterEach(() => {
    config.maxBotToken = old;
    vi.unstubAllGlobals();
  });

  const sent: { to: number; text: string }[] = [];
  const say = async (to: number, text: string) => void sent.push({ to, text });
  const maxOf = async (login: string) =>
    (await pool.query(`SELECT max_user_id AS id, notify_max AS on FROM users WHERE login = $1`, [login])).rows[0];

  it('кнопка выдаёт код и ссылку на бота, бот по ссылке привязывает аккаунт и включает Max', async () => {
    const lenya = await loginAs('lenya');
    const r = await lenya.post('/api/auth/me/max-link');
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const raw = r.body.code.replace('-', '');
    expect(r.body.link).toBe(`https://max.ru/service_bot?start=${raw}`);
    expect(await maxOf('lenya')).toEqual({ id: null, on: false });

    sent.length = 0;
    await processUpdate({ update_type: 'bot_started', user: { user_id: 777 }, payload: raw }, say);
    expect(await maxOf('lenya')).toEqual({ id: '777', on: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(777);
    expect(sent[0].text).toContain('Готово');
    expect((await lenya.get('/api/auth/me')).body.user.maxUserId).toBe('777');
  });

  it('код работает один раз; код, присланный текстом (в любом написании), тоже подходит', async () => {
    const stas = await loginAs('stas');
    const code = (await stas.post('/api/auth/me/max-link')).body.code as string;
    sent.length = 0;
    await processUpdate({ update_type: 'message_created', message: { sender: { user_id: 888 }, body: { text: ` ${code.toLowerCase()} ` } } }, say);
    expect((await maxOf('stas')).id).toBe('888');
    // второй раз тем же кодом, с другого аккаунта Max
    await processUpdate({ update_type: 'bot_started', user: { user_id: 999 }, payload: code.replace('-', '') }, say);
    expect((await maxOf('stas')).id).toBe('888');
    expect(sent[1].text).toBe(badCodeText);
  });

  it('новый код отменяет прежний, просроченный не работает', async () => {
    const lenya = await loginAs('lenya');
    const first = (await lenya.post('/api/auth/me/max-link')).body.code.replace('-', '');
    const second = (await lenya.post('/api/auth/me/max-link')).body.code.replace('-', '');
    sent.length = 0;
    await processUpdate({ update_type: 'bot_started', user: { user_id: 101 }, payload: first }, say);
    expect(sent[0].text).toBe(badCodeText);
    await pool.query(`UPDATE max_link_codes SET expires_at = now() - interval '1 minute'`);
    await processUpdate({ update_type: 'bot_started', user: { user_id: 101 }, payload: second }, say);
    expect(sent[1].text).toBe(badCodeText);
    expect((await maxOf('lenya')).id).toBe('777');
  });

  it('аккаунт Max, уже занятый другим сотрудником, переходит к новому, у прежнего отключается', async () => {
    const stas = await loginAs('stas');
    const code = (await stas.post('/api/auth/me/max-link')).body.code.replace('-', '');
    await processUpdate({ update_type: 'bot_started', user: { user_id: 777 }, payload: code }, say);
    expect(await maxOf('stas')).toEqual({ id: '777', on: true });
    expect(await maxOf('lenya')).toEqual({ id: null, on: false });
    // прежний владелец узнаёт об этом из уведомления
    const lenya = await loginAs('lenya');
    const titles = (await lenya.get('/api/notifications')).body.items.map((n: any) => n.title);
    expect(titles).toContain('Max отключён от вашего профиля');
  });

  it('сотрудник сам отключает Max: привязка и незавершённый код снимаются', async () => {
    const stas = await loginAs('stas');
    expect((await maxOf('stas')).id).toBe('777');
    await stas.post('/api/auth/me/max-link');
    const r = await stas.post('/api/auth/me/max-unlink');
    expect(r.status).toBe(200);
    expect(r.body.maxUserId).toBeNull();
    expect(await maxOf('stas')).toEqual({ id: null, on: false });
    expect((await pool.query('SELECT 1 FROM max_link_codes WHERE user_id = (SELECT id FROM users WHERE login = $1)', ['stas'])).rowCount).toBe(0);
  });

  it('без кода бот подсказывает, как подключиться, и называет id для ручного ввода; без токена кнопка отказывает', async () => {
    sent.length = 0;
    await processUpdate({ update_type: 'message_created', message: { sender: { user_id: 55 }, body: { text: 'привет' } } }, say);
    expect(sent[0].text).toContain('Подключить Max');
    expect(sent[0].text).toContain('55');
    config.maxBotToken = '';
    const lenya = await loginAs('lenya');
    expect((await lenya.post('/api/auth/me/max-link')).status).toBe(400);
  });
});
