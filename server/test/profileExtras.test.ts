import bcrypt from 'bcryptjs';
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

describe('смена логина: заказчик и логины сотрудников', () => {
  it('заказчик меняет логин сам, но не может взять логин сотрудника', async () => {
    await pool.query(`INSERT INTO users (login, password_hash, full_name, role) VALUES ('zakaz', $1, 'Заказчик', 'customer')`, [
      await bcrypt.hash(PASSWORD, 10),
    ]);
    const s = await loginAs('zakaz');
    // занятый и зарезервированный (в том числе другим регистром) логины сотрудников
    expect((await s.post('/api/auth/me/login', { login: 'isakov', current: PASSWORD })).status).toBe(409);
    const reserved = await s.post('/api/auth/me/login', { login: 'Kataev', current: PASSWORD });
    expect(reserved.status).toBe(409);
    expect(reserved.body.fields.login).toBeDefined();
    // свободный логин можно
    const ok = await s.post('/api/auth/me/login', { login: 'zakaz-new', current: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.login).toBe('zakaz-new');
  });

  it('при регистрации логин сотрудника тоже занять нельзя', async () => {
    const r = await request(app)
      .post('/api/auth/register')
      .send({ kind: 'person', login: 'Maria', password: PASSWORD, fullName: 'Мария Тест', phone: '+7 900 000-00-00' });
    expect(r.status).toBe(409);
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
    // длинные строки календаря переносятся: перед проверкой склеиваем
    expect(feed.text.replace(/\r\n /g, '')).toContain('Настроить CRM\\, срочно\\; важно');
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

  it('все открытые задачи сотрудника в ленте: свои, переданные ему, с несколькими ответственными, на одно время', async () => {
    const { users } = await dict();
    const golenkov = await loginAs('golenkov');
    const isakov = await loginAs('isakov');
    const due = new Date(Date.now() + 26 * 3_600_000).toISOString();
    const mk = async (s: typeof golenkov, title: string, who: number[]) =>
      (await s.post('/api/tasks', { title, assigneeIds: who, startAt: new Date().toISOString(), dueAt: due })).body.id as number;
    const mine = await mk(isakov, 'Ремонт ПК своя', [users.isakov]);
    const shared = await mk(golenkov, 'Ремонт МФУ общая', [users.golenkov, users.isakov]);
    const moved = await mk(golenkov, 'Диагностика переданная', [users.golenkov]);
    const tr = await golenkov.post(`/api/tasks/${moved}/transfer`, { assigneeId: users.isakov, dueAt: due, comment: 'Тебе' });
    expect(tr.status).toBe(200);
    const closed = await mk(isakov, 'Закрытая диагностика', [users.isakov]);
    await isakov.post('/api/tasks/close', { ids: [closed], comment: 'Готово' });

    const { token } = (await isakov.post('/api/auth/me/calendar')).body;
    const before = (await isakov.get('/api/auth/me/calendar')).body;
    expect(before.fetchedAt).toBeNull();
    const feed = await request(app).get(`/api/calendar/${token}.ics`);
    for (const id of [mine, shared, moved]) expect(feed.text).toContain(`UID:task-${id}@servicedesk`);
    expect(feed.text).not.toContain(`task-${closed}@`);

    // профиль показывает, когда ленту забрали и сколько задач в ней было
    const after = (await isakov.get('/api/auth/me/calendar')).body;
    expect(after.fetchedAt).not.toBeNull();
    expect(after.fetchedTasks).toBe(after.tasksNow);
    expect(after.tasksNow).toBeGreaterThanOrEqual(3);
  });

  it('формат: одиночный перевод строки и управляющие символы не создают новых строк календаря', () => {
    const ics = buildCalendar(
      [
        {
          id: 2,
          title: 'Задача\rEND:VEVENT\rBEGIN:VEVENT\x00',
          description: 'а\r\nб',
          dueAt: new Date('2026-11-05T10:00:00Z'),
          updatedAt: new Date(),
          clientName: null,
          orderNumber: null,
        },
      ],
      'https://example.test',
      'Задачи',
    );
    expect(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics).not.toMatch(/\r(?!\n)/);
    expect(ics).not.toContain('\x00');
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
