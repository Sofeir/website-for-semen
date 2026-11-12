import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('передал не тому: исправить передачу', () => {
  it('передавший может передать задачу заново, пока она у адресата; закрыть и править не может', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const made = await semen.post('/api/tasks', {
      title: 'Передача по ошибке',
      assigneeId: users.isakov,
      startAt: new Date().toISOString(),
      dueAt: inDays(2),
    });
    expect(made.status).toBe(201);
    const id = made.body.id as number;

    const stas = await loginAs('isakov');
    // Станислав передал не тому (Артёму), хотя хотел Голенкову
    expect((await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Ошибся адресом' })).status).toBe(200);

    const seen = await stas.get(`/api/tasks/${id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.handedOverById).toBe(users.isakov);

    // Других прав у передавшего нет
    expect((await stas.post('/api/tasks/close', { ids: [id], comment: null })).body.closed).toEqual([]);

    // Передать заново можно
    const again = await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.golenkov, dueAt: inDays(2), comment: 'Это не к Артёму, к Голенкову' });
    expect(again.status).toBe(200);
    const row = (await pool.query('SELECT assignee_id FROM tasks WHERE id = $1', [id])).rows[0];
    expect(row.assignee_id).toBe(users.golenkov);
    const owners = (await pool.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [id])).rows.map((r) => r.user_id);
    expect(owners).toEqual([users.golenkov]);

    // Теперь у Голенкова передавший уже Станислав: он по-прежнему может исправить; Артём нет
    const artem = await loginAs('kataev');
    expect((await artem.post(`/api/tasks/${id}/transfer`, { assigneeId: users.isakov, dueAt: inDays(2), comment: 'Верните' })).status).toBe(403);
  });

  it('задача этапа заявки: передавший исправляет адресата, ответственный по заявке меняется вместе с задачей', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 555-00-77');
    const taskId = (await pool.query('SELECT id FROM tasks WHERE order_id = $1 AND status = $2 ORDER BY id DESC LIMIT 1', [orderId, 'open'])).rows[0]
      .id as number;
    const stas = await loginAs('isakov');
    expect((await stas.post(`/api/tasks/${taskId}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Не тому' })).status).toBe(200);
    expect((await stas.get(`/api/tasks/${taskId}`)).body.handedOverById).toBe(users.isakov);
    // на странице заявки передавшему тоже видно, что передачу можно исправить
    const page = await stas.get(`/api/orders/${orderId}`);
    expect(page.status).toBe(200);
    expect(page.body.handedOverByMe).toBe(true);
    expect((await (await loginAs('kataev')).get(`/api/orders/${orderId}`)).body.handedOverByMe).toBe(false);
    const again = await stas.post(`/api/tasks/${taskId}/transfer`, { assigneeId: users.golenkov, dueAt: inDays(2), comment: 'Правильно: Голенкову' });
    expect(again.status).toBe(200);
    expect((await pool.query('SELECT responsible_id FROM orders WHERE id = $1', [orderId])).rows[0].responsible_id).toBe(users.golenkov);
    expect((await pool.query('SELECT assignee_id FROM tasks WHERE id = $1', [taskId])).rows[0].assignee_id).toBe(users.golenkov);
  });

  it('передавший может вернуть задачу себе, пока она не просрочена; просроченную срок согласует директор', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const mk = async (title: string) =>
      (await semen.post('/api/tasks', { title, assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) })).body.id as number;
    const stas = await loginAs('isakov');
    const a = await mk('Верну себе');
    await stas.post(`/api/tasks/${a}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Не тому' });
    const back = await stas.post(`/api/tasks/${a}/transfer`, { assigneeId: users.isakov, dueAt: inDays(2), comment: 'Беру обратно' });
    expect(back.status).toBe(200);
    expect(back.body.requested).toBe(false);
    expect((await pool.query('SELECT assignee_id FROM tasks WHERE id = $1', [a])).rows[0].assignee_id).toBe(users.isakov);

    const b = await mk('Просрочена');
    await stas.post(`/api/tasks/${b}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Не тому' });
    await pool.query(`UPDATE tasks SET due_at = now() - interval '1 hour' WHERE id = $1`, [b]);
    const late = await stas.post(`/api/tasks/${b}/transfer`, { assigneeId: users.isakov, dueAt: inDays(3), comment: 'Беру обратно' });
    expect(late.status).toBe(200);
    expect(late.body.requested).toBe(true);
  });

  it('после того как адресат сам передал дальше, прежний передавший права теряет', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const id = (
      await semen.post('/api/tasks', { title: 'Цепочка', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) })
    ).body.id as number;
    const stas = await loginAs('isakov');
    const artem = await loginAs('kataev');
    expect((await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Тебе' })).status).toBe(200);
    expect((await artem.post(`/api/tasks/${id}/transfer`, { assigneeId: users.golenkov, dueAt: inDays(2), comment: 'Дальше' })).status).toBe(200);
    expect((await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Назад' })).status).toBe(403);
    expect((await stas.get(`/api/tasks/${id}`)).body.handedOverById).toBeNull();
  });
});

describe('готовая техника: передача ответственному', () => {
  it('задача «Готово, ожидает выдачи» передаётся другому ответственному, в том числе когда её срок уже прошёл', async () => {
    const { users, stage } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 555-00-88');
    for (const code of ['approval', 'repair', 'ready']) {
      const r = await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage[code], responsibleId: users.isakov, dueAt: inDays(1), comment: 'дальше' });
      expect(r.status).toBe(200);
    }
    const taskId = (await pool.query(`SELECT id FROM tasks WHERE order_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`, [orderId])).rows[0].id as number;
    await pool.query(`UPDATE tasks SET due_at = now() - interval '3 days' WHERE id = $1`, [taskId]);
    await pool.query(`UPDATE orders SET stage_due_at = now() - interval '3 days' WHERE id = $1`, [orderId]);

    const stas = await loginAs('isakov');
    const cur = (await stas.get(`/api/tasks/${taskId}`)).body;
    // клиент шлёт прежний срок, как в окне «Передать»
    const r = await stas.post(`/api/tasks/${taskId}/transfer`, { assigneeId: users.kataev, dueAt: cur.dueAt, comment: 'Выдавать будет Артём' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await pool.query('SELECT responsible_id FROM orders WHERE id = $1', [orderId])).rows[0].responsible_id).toBe(users.kataev);

    // и обратно тому, кто передал, тоже можно исправить
    const back = await stas.post(`/api/tasks/${taskId}/transfer`, { assigneeId: users.golenkov, dueAt: cur.dueAt, comment: 'Нет, Голенкову' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
  });
});

describe('«Передал не тому» заменяет передачу, а не дописывает', () => {
  const notices = async (userId: number, link: string) =>
    (await pool.query(`SELECT type FROM notifications WHERE user_id = $1 AND link = $2 ORDER BY id`, [userId, link])).rows.map((r) => r.type as string);

  it('задача: ошибочного адресата нет ни в цепочке, ни в уведомлениях', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const id = (await semen.post('/api/tasks', { title: 'Замена адресата', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) })).body.id as number;
    const stas = await loginAs('isakov');
    expect((await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Тебе' })).status).toBe(200);
    expect(await notices(users.kataev, `/tasks?task=${id}`)).toContain('task_assigned');

    const fix = await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.golenkov, dueAt: inDays(2), comment: 'Нет, Голенкову', correction: true });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);

    const steps = (await pool.query('SELECT assignee_id, from_user_id, comment, done_at FROM task_steps WHERE task_id = $1 ORDER BY id', [id])).rows;
    expect(steps.map((s) => s.assignee_id)).toEqual([users.isakov, users.golenkov]);
    expect(steps[1].comment).toBe('Нет, Голенкову');
    expect(steps[1].done_at).toBeNull();
    // Артём не получает ни «Вам передали», ни «Задачу передали»
    expect(await notices(users.kataev, `/tasks?task=${id}`)).toEqual([]);
    expect(await notices(users.golenkov, `/tasks?task=${id}`)).toContain('task_assigned');
    expect((await pool.query('SELECT count(*)::int AS n FROM transfer_corrections WHERE task_id = $1', [id])).rows[0].n).toBe(1);
  });

  it('вернуть себе: прежний шаг открывается снова, ошибочного адресата в цепочке нет', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const id = (await semen.post('/api/tasks', { title: 'Вернуть себе', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) })).body.id as number;
    const stas = await loginAs('isakov');
    await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Тебе' });
    const fix = await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.isakov, dueAt: inDays(2), comment: 'Ошибся, моя', correction: true });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    const steps = (await pool.query('SELECT assignee_id, done_at FROM task_steps WHERE task_id = $1 ORDER BY id', [id])).rows;
    expect(steps).toHaveLength(1);
    expect(steps[0].assignee_id).toBe(users.isakov);
    expect(steps[0].done_at).toBeNull();
    expect((await pool.query('SELECT assignee_id FROM tasks WHERE id = $1', [id])).rows[0].assignee_id).toBe(users.isakov);
  });

  it('исправить может только тот, кто передал и пока задача у адресата', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const id = (await semen.post('/api/tasks', { title: 'Чужая передача', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) })).body.id as number;
    const stas = await loginAs('isakov');
    const artem = await loginAs('kataev');
    await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Тебе' });
    // адресат не передавал: исправлять нечего
    expect((await artem.post(`/api/tasks/${id}/transfer`, { assigneeId: users.golenkov, dueAt: inDays(2), comment: 'Не мне', correction: true })).status).toBe(409);
    // постановку (шаг без причины) исправить нельзя
    const fresh = (await semen.post('/api/tasks', { title: 'Постановка', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) })).body.id as number;
    expect((await semen.post(`/api/tasks/${fresh}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Другому', correction: true })).status).toBe(409);
  });

  it('заявка: запись передачи заменяется, задача этапа и ответственный меняются вместе', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 555-00-91');
    const stas = await loginAs('isakov');
    expect((await stas.post(`/api/orders/${orderId}/reassign`, { responsibleId: users.kataev, dueAt: inDays(2), comment: 'Артёму' })).status).toBe(200);
    expect(await notices(users.kataev, `/orders/${orderId}`)).toContain('order_assigned');

    const fix = await stas.post(`/api/orders/${orderId}/reassign`, { responsibleId: users.golenkov, dueAt: inDays(2), comment: 'Голенкову', correction: true });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect((await pool.query('SELECT responsible_id FROM orders WHERE id = $1', [orderId])).rows[0].responsible_id).toBe(users.golenkov);
    const hist = (await pool.query(`SELECT responsible_id, kind FROM order_history WHERE order_id = $1 ORDER BY id`, [orderId])).rows;
    expect(hist.some((h) => h.responsible_id === users.kataev)).toBe(false);
    expect(hist.at(-1)).toMatchObject({ responsible_id: users.golenkov, kind: 'transfer' });
    expect(await notices(users.kataev, `/orders/${orderId}`)).toEqual([]);
    const task = (await pool.query(`SELECT id, assignee_id FROM tasks WHERE order_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`, [orderId])).rows[0];
    expect(task.assignee_id).toBe(users.golenkov);
    const steps = (await pool.query('SELECT assignee_id FROM task_steps WHERE task_id = $1 ORDER BY id', [task.id])).rows.map((r) => r.assignee_id);
    expect(steps).not.toContain(users.kataev);
  });
});
