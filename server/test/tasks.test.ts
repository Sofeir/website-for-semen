import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { addWorkDays, clampToWorkEnd } from '../src/services/workTime';
import { DEFAULT_WORK } from '../src/services/settings';
import { dict, inDays, loginAs, resetDb } from './helpers';

describe('рабочее время', () => {
  it('срок позже 20:00 переносится на 20:00 того же дня', () => {
    const d = new Date(2026, 9, 14, 22, 30);
    expect(clampToWorkEnd(d, DEFAULT_WORK).getHours()).toBe(20);
  });

  it('срок «через 1 рабочий день» с пятницы — понедельник 20:00', () => {
    const friday = new Date(2026, 9, 16, 12, 0);
    const due = addWorkDays(friday, 1, DEFAULT_WORK);
    expect(due.getDay()).toBe(1);
    expect(due.getHours()).toBe(20);
  });
});

describe('массовое закрытие задач', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('исполнитель закрывает пачку, постановщики получают уведомления с комментарием', async () => {
    const semen = await loginAs('semen');
    const olga = await loginAs('olga');
    const stas = await loginAs('stas');
    const { users } = await dict();
    const ids: number[] = [];
    for (const [who, title] of [
      [semen, 'Позвонить клиенту'],
      [stas, 'Проверить SSD'],
      [olga, 'Своя задача'],
    ] as const) {
      const r = await who.post('/api/tasks', {
        title,
        assigneeId: users.olga,
        startAt: new Date().toISOString(),
        dueAt: inDays(1),
      });
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    const res = await olga.post('/api/tasks/close', { ids, comment: 'Готово, всё проверила' });
    expect(res.status).toBe(200);
    expect(res.body.closed.sort()).toEqual([...ids].sort());

    const notes = await pool.query(
      `SELECT user_id FROM notifications WHERE type = 'task_closed' AND body LIKE '%всё проверила%'`,
    );
    const notified = notes.rows.map((r) => r.user_id).sort();
    // Себе уведомление не шлём.
    expect(notified).toEqual([users.semen, users.stas].sort());
  });

  it('чужие задачи диагност закрыть не может — они пропускаются', async () => {
    const semen = await loginAs('semen');
    const stas = await loginAs('stas');
    const { users } = await dict();
    const r = await semen.post('/api/tasks', {
      title: 'Задача Лёни',
      assigneeId: users.lenya,
      startAt: new Date().toISOString(),
      dueAt: inDays(1),
    });
    const res = await stas.post('/api/tasks/close', { ids: [r.body.id] });
    expect(res.body.closed).toEqual([]);
    expect(res.body.skipped).toEqual([r.body.id]);
  });

  it('передача задачи строит цепочку шагов', async () => {
    const semen = await loginAs('semen');
    const stas = await loginAs('stas');
    const { users } = await dict();
    const r = await semen.post('/api/tasks', {
      title: 'Цепочка',
      assigneeId: users.stas,
      startAt: new Date().toISOString(),
      dueAt: inDays(1),
    });
    await stas.post(`/api/tasks/${r.body.id}/transfer`, { assigneeId: users.lenya, dueAt: inDays(2), comment: 'Тебе' });
    const task = (await semen.get(`/api/tasks/${r.body.id}`)).body;
    expect(task.steps).toHaveLength(2);
    expect(task.steps[0].doneAt).not.toBeNull();
    expect(task.steps[1].assigneeId).toBe(users.lenya);
  });
});
