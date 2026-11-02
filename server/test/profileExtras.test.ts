import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { buildCalendar } from '../src/services/ical';
import { app, dict, loginAs, PASSWORD, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('смена логина', () => {
  it('по текущему паролю: новый логин работает, старый нет, сессия остаётся', async () => {
    const s = await loginAs('kataev');
    const r = await s.post('/api/auth/me/login', { login: 'Artem.Kataev', current: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.login).toBe('Artem.Kataev');
    // сессия жива
    expect((await s.get('/api/auth/me')).status).toBe(200);
    // вход: новый логин (без учёта регистра) работает, старый нет
    const ok = await request(app).post('/api/auth/login').send({ login: 'artem.kataev', password: PASSWORD });
    expect(ok.status).toBe(200);
    const old = await request(app).post('/api/auth/login').send({ login: 'kataev', password: PASSWORD });
    expect(old.status).toBe(401);
  });

  it('неверный пароль, занятый и неподходящий логин отклоняются', async () => {
    const s = await loginAs('isakov');
    const wrong = await s.post('/api/auth/me/login', { login: 'isakov2', current: 'неверный-пароль' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields.current).toBeDefined();
    // чужой логин, в том числе другим регистром
    const taken = await s.post('/api/auth/me/login', { login: 'SEMEN', current: PASSWORD });
    expect(taken.status).toBe(409);
    expect(taken.body.fields.login).toBeDefined();
    // кириллица и пробелы нельзя
    expect((await s.post('/api/auth/me/login', { login: 'исаков', current: PASSWORD })).status).toBe(400);
    expect((await s.post('/api/auth/me/login', { login: 'is akov', current: PASSWORD })).status).toBe(400);
    // свой же логин другим регистром менять можно
    expect((await s.post('/api/auth/me/login', { login: 'Isakov', current: PASSWORD })).status).toBe(200);
  });
});

describe('календарь задач', () => {
  beforeAll(resetDb);

  it('без ссылки лента закрыта, со ссылкой отдаёт только мои открытые задачи', async () => {
    const { users } = await dict();
    const golenkov = await loginAs('golenkov');
    expect((await golenkov.get('/api/auth/me/calendar')).body.token).toBeNull();
    expect((await request(app).get('/api/calendar/zzzzzzzzzzzzzzzzzzzzzzzz.ics')).status).toBe(404);

    const created = await golenkov.post('/api/tasks', {
      title: 'Настроить CRM, срочно; важно',
      description: 'Первая строка\nВторая строка',
      assigneeIds: [users.isakov, users.kataev],
      startAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await golenkov.post('/api/tasks', {
      title: 'Чужая задача',
      assigneeId: users.kataev,
      startAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const isakov = await loginAs('isakov');
    const { token } = (await isakov.post('/api/auth/me/calendar')).body;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect((await isakov.get('/api/auth/me/calendar')).body.token).toBe(token);

    // лента открывается без входа
    const feed = await request(app).get(`/api/calendar/${token}.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.text).toContain('BEGIN:VCALENDAR');
    expect(feed.text).toContain(`UID:task-${created.body.id}@servicedesk`);
    expect(feed.text).toContain('Настроить CRM\\, срочно\\; важно');
    expect(feed.text).not.toContain('Чужая задача');

    // закрытая задача пропадает из ленты
    await isakov.post('/api/tasks/close', { ids: [created.body.id], comment: 'Готово' });
    const after = await request(app).get(`/api/calendar/${token}.ics`);
    expect(after.text).not.toContain(`task-${created.body.id}@`);

    // замена ссылки: старая перестаёт работать
    const next = (await isakov.post('/api/auth/me/calendar')).body.token;
    expect(next).not.toBe(token);
    expect((await request(app).get(`/api/calendar/${token}.ics`)).status).toBe(404);
    expect((await request(app).get(`/api/calendar/${next}.ics`)).status).toBe(200);

    // отключение
    await isakov.del('/api/auth/me/calendar');
    expect((await request(app).get(`/api/calendar/${next}.ics`)).status).toBe(404);
  });

  it('формат: длинные русские строки переносятся по 75 байт и не рвут буквы', () => {
    const ics = buildCalendar(
      [
        {
          id: 1,
          title: 'Очень длинное название задачи, которое точно не поместится в одну строку календаря и будет перенесено',
          description: null,
          dueAt: new Date('2026-11-05T10:00:00Z'),
          updatedAt: new Date('2026-11-02T10:00:00Z'),
          clientName: 'ООО «РБЕ Урал»',
          orderNumber: '001003',
        },
      ],
      'https://example.test',
      'Задачи',
      new Date('2026-11-02T10:00:00Z'),
    );
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    // после разворачивания переносов текст целый
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('Очень длинное название задачи');
    expect(unfolded).toContain('DTSTART:20261105T093000Z');
    expect(unfolded).toContain('DTEND:20261105T100000Z');
    expect(unfolded).toContain('Заявка №001003');
  });
});
