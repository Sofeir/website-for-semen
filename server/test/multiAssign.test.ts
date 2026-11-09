import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { notifyDeadlineReminders, notifyOverdueTasks } from '../src/services/overdue';
import { dict, inDays, loginAs, resetDb } from './helpers';

/** Кому пришли уведомления с заданным заголовком (логины). */
async function got(title: string, type?: string) {
  const r = await pool.query(
    `SELECT u.login FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.title LIKE $1 ${type ? 'AND n.type = $2' : ''} ORDER BY u.login`,
    type ? [`%${title}%`, type] : [`%${title}%`],
  );
  return r.rows.map((x) => x.login as string);
}

const newTask = (title: string, assigneeIds: number[], dueAt = new Date(Date.now() + 3_600_000).toISOString()) => ({
  title,
  assigneeIds,
  startAt: new Date().toISOString(),
  dueAt,
});

describe('несколько ответственных и кому приходят уведомления', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('задачу можно поставить сразу нескольким: каждый видит её у себя, директорам ничего не приходит', async () => {
    const golenkov = await loginAs('golenkov');
    const { users } = await dict();
    const r = await golenkov.post('/api/tasks', newTask('Настроить CRM', [users.isakov, users.kataev]));
    expect(r.status).toBe(201);

    for (const login of ['isakov', 'kataev']) {
      const s = await loginAs(login);
      const mine = (await s.get('/api/tasks?scope=mine')).body.map((t: any) => t.title);
      expect(mine).toContain('Настроить CRM');
    }
    const t = (await golenkov.get(`/api/tasks/${r.body.id}`)).body;
    expect(t.assigneeIds).toHaveLength(2);
    expect(t.assigneeName).toContain('Исаков');
    expect(t.assigneeName).toContain('Катаев');

    expect(await got('Новая задача: Настроить CRM')).toEqual(['isakov', 'kataev']);
    // директор и второй директор в задаче не участвуют, поэтому ничего не получают
    const semen = await loginAs('semen');
    expect((await semen.get('/api/tasks?scope=mine')).body.map((x: any) => x.title)).not.toContain('Настроить CRM');
  });

  it('закрыть задачу может любой из ответственных, об этом узнают все участники, кроме закрывшего', async () => {
    const golenkov = await loginAs('golenkov');
    const { users } = await dict();
    const r = await golenkov.post('/api/tasks', newTask('Обновить прайс', [users.isakov, users.kataev]));
    const kataev = await loginAs('kataev');
    const closed = await kataev.post('/api/tasks/close', { ids: [r.body.id], comment: 'Готово' });
    expect(closed.body.closed).toEqual([r.body.id]);
    expect(await got('Задача закрыта: Обновить прайс')).toEqual(['golenkov', 'isakov']);
  });

  it('при передаче передавший и прошлые участники продолжают получать уведомления, чужие директора нет', async () => {
    const golenkov = await loginAs('golenkov');
    const { users } = await dict();
    const r = await golenkov.post('/api/tasks', newTask('Починить сервер', [users.isakov]));
    const isakov = await loginAs('isakov');
    const tr = await isakov.post(`/api/tasks/${r.body.id}/transfer`, {
      assigneeId: users.kataev,
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      comment: 'Нужен мастер для замены диска',
    });
    expect(tr.status).toBe(200);
    expect(await got('Задачу передали: Починить сервер')).toEqual(['golenkov']);
    expect(await got('Вам передали задачу: Починить сервер')).toEqual(['kataev']);

    const kataev = await loginAs('kataev');
    await kataev.post('/api/tasks/close', { ids: [r.body.id], comment: 'Диск заменён' });
    // закрыл Катаев: об этом узнают поставивший Голенков и передавший Исаков
    expect(await got('Задача закрыта: Починить сервер')).toEqual(['golenkov', 'isakov']);
    expect(await got('Починить сервер')).not.toContain('semen');
    expect(await got('Починить сервер')).not.toContain('leonid');
  });

  it('просрочка приходит ответственным, постановщику и передавшему, а директорам за всех нет', async () => {
    const { users } = await dict();
    const ins = await pool.query(
      `INSERT INTO tasks (title, creator_id, assignee_id, start_at, due_at) VALUES ('Просроченная', $1, $2, now() - interval '3 days', now() - interval '1 hour') RETURNING id`,
      [users.golenkov, users.isakov],
    );
    await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [ins.rows[0].id, users.kataev]);
    await notifyOverdueTasks();
    expect(await got('Просрочена задача: Просроченная')).toEqual(['golenkov', 'isakov', 'kataev']);
    // повторно не шлём
    await notifyOverdueTasks();
    expect(await got('Просрочена задача: Просроченная')).toHaveLength(3);
  });

  it('напоминания: за сутки, за 2 часа и за 15 минут, ответственным и по одному разу', async () => {
    const { users } = await dict();
    const mk = async (title: string, interval: string) => {
      const r = await pool.query(
        `INSERT INTO tasks (title, creator_id, assignee_id, start_at, due_at, remind_from) VALUES ($1, $2, $3, now(), now() + $4::interval, now() - interval '3 days') RETURNING id`,
        [title, users.golenkov, users.isakov, interval],
      );
      await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [r.rows[0].id, users.kataev]);
    };
    await mk('Срок завтра', '20 hours');
    await mk('Срок скоро', '90 minutes');
    await mk('Срок не скоро', '5 days');
    await notifyDeadlineReminders();
    expect(await got('Через 1 день крайний срок: Срок завтра')).toEqual(['isakov', 'kataev']);
    expect(await got('Через 2 часа крайний срок: Срок скоро')).toEqual(['isakov', 'kataev']);
    // задача с близким сроком не получает ещё и «за сутки»
    expect(await got('Через 1 день крайний срок: Срок скоро')).toEqual([]);
    expect(await got('Срок не скоро')).toEqual([]);
    await notifyDeadlineReminders();
    expect(await got('Через 1 день крайний срок: Срок завтра')).toHaveLength(2);
  });

  it('задача, поставленная уже внутри окна, не получает напоминание сразу после создания', async () => {
    const golenkov = await loginAs('golenkov');
    const { users } = await dict();
    const r = await golenkov.post('/api/tasks', newTask('Сегодня срочно', [users.isakov], new Date(Date.now() + 5 * 3_600_000).toISOString()));
    expect(r.status).toBe(201);
    await notifyDeadlineReminders();
    expect(await got('Сегодня срочно', 'task_reminder')).toEqual([]);
  });

  it('заявка: передавший остаётся в курсе, директора вне заявки уведомлений не получают', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const orderId = await (await import('./helpers')).intakeLaptop(semen, users.isakov, '+7 900 555-00-01');
    const isakov = await loginAs('isakov');
    // срок при передаче заявки можно отодвинуть, пока он не прошёл
    const r = await isakov.post(`/api/orders/${orderId}/reassign`, {
      responsibleId: users.kataev,
      dueAt: inDays(5),
      comment: 'Нужна замена SSD',
    });
    expect(r.status).toBe(200);
    // принимал Семён (он же и сделал приём, поэтому себе не шлёт); Леониду, который не участвует, ничего не приходит
    const leonid = await pool.query(
      `SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'leonid' AND n.link = $1`,
      [`/orders/${orderId}`],
    );
    expect(leonid.rows[0].n).toBe(0);
    const kataev = await loginAs('kataev');
    const adv = await kataev.get(`/api/orders/${orderId}`);
    expect(adv.status).toBe(200);
  });
});
