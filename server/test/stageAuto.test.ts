import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb, satisfyStageChecks } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

const openTask = async (orderId: number) =>
  (await pool.query(`SELECT id, stage_id FROM tasks WHERE order_id = $1 AND status = 'open' AND stage_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [orderId])).rows[0] as {
    id: number;
    stage_id: number;
  };

describe('закрытие задачи этапа двигает заявку', () => {
  it('диагностика: закрыл задачу, заявка перешла на согласование, ответственный прежний, новая задача этапа открыта', async () => {
    const { users, stage } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.isakov, '+7 900 777-00-01');
    const stas = await loginAs('isakov');
    const t = await openTask(orderId);
    const r = await stas.post('/api/tasks/close', { ids: [t.id], comment: 'Диагностика завершена' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.closed).toEqual([t.id]);
    const order = (await pool.query('SELECT stage_id, responsible_id FROM orders WHERE id = $1', [orderId])).rows[0];
    expect(order.stage_id).toBe(stage.approval);
    expect(order.responsible_id).toBe(users.isakov);
    const next = await openTask(orderId);
    expect(next.stage_id).toBe(stage.approval);
    expect(next.id).not.toBe(t.id);
  });

  it('согласование и выдачу пачкой не закрыть: нужны кнопки «Согласовано»/«Отказ» и отметка о возврате техники', async () => {
    const { users, stage } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.semen, '+7 900 777-00-02');
    await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    const t = await openTask(orderId);
    const r = await semen.post('/api/tasks/close', { ids: [t.id], comment: null });
    expect(r.status).toBe(409);
    expect(r.body.need).toBe('decision');
    expect((await pool.query('SELECT stage_id FROM orders WHERE id = $1', [orderId])).rows[0].stage_id).toBe(stage.approval);

    // пачкой ответ без ошибки, но задача не закрыта
    const bulk = await semen.post('/api/tasks/close', { ids: [t.id, t.id + 0], comment: null });
    expect(bulk.status).toBe(200);
    expect(bulk.body.closed).toEqual([]);
    expect(bulk.body.blocked[0].need).toBe('decision');
  });

  it('ремонт нельзя закрыть без записанной работы, согласование без срока и суммы', async () => {
    const { users, stage } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.semen, '+7 900 777-00-03');
    await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    // без срока и суммы
    const noAgreed = await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.repair, responsibleId: users.semen, dueAt: inDays(1) });
    expect(noAgreed.status).toBe(409);
    expect(noAgreed.body.need).toBe('agreed');
    // отказ клиента проходит и без суммы
    await pool.query(`UPDATE orders SET agreed_term = '2 дня', agreed_sum = 500 WHERE id = $1`, [orderId]);
    expect((await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.repair, responsibleId: users.semen, dueAt: inDays(1) })).status).toBe(200);
    // ремонт без работы
    const noWork = await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.ready, responsibleId: users.semen, dueAt: inDays(1) });
    expect(noWork.status).toBe(409);
    expect(noWork.body.need).toBe('works');
    await satisfyStageChecks(orderId);
    expect((await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.ready, responsibleId: users.semen, dueAt: inDays(1) })).status).toBe(200);
  });

  it('закрытие задачи ремонта без работы не двигает заявку и говорит, чего не хватает', async () => {
    const { users, stage } = await dict();
    const semen = await loginAs('semen');
    const orderId = await intakeLaptop(semen, users.semen, '+7 900 777-00-04');
    await pool.query(`UPDATE orders SET agreed_term = '2 дня', agreed_sum = 500 WHERE id = $1`, [orderId]);
    await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    await semen.post(`/api/orders/${orderId}/advance`, { toStageId: stage.repair, responsibleId: users.semen, dueAt: inDays(1) });
    const t = await openTask(orderId);
    const r = await semen.post('/api/tasks/close', { ids: [t.id], comment: 'Готово' });
    expect(r.status).toBe(409);
    expect(r.body.need).toBe('works');
    expect((await pool.query('SELECT stage_id FROM orders WHERE id = $1', [orderId])).rows[0].stage_id).toBe(stage.repair);
    expect((await pool.query('SELECT status FROM tasks WHERE id = $1', [t.id])).rows[0].status).toBe('open');
  });
});
