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

    // Забрать задачу обратно себе нельзя
    expect((await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.isakov, dueAt: inDays(2), comment: 'Верну себе' })).status).toBe(403);

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
    const again = await stas.post(`/api/tasks/${taskId}/transfer`, { assigneeId: users.golenkov, dueAt: inDays(2), comment: 'Правильно: Голенкову' });
    expect(again.status).toBe(200);
    expect((await pool.query('SELECT responsible_id FROM orders WHERE id = $1', [orderId])).rows[0].responsible_id).toBe(users.golenkov);
    expect((await pool.query('SELECT assignee_id FROM tasks WHERE id = $1', [taskId])).rows[0].assignee_id).toBe(users.golenkov);
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
