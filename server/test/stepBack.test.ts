import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb, satisfyStageChecks } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('возврат заявки на этап назад', () => {
  it('причина обязательна, задача прошлого этапа открывается заново, текущая закрывается', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.isakov, '+7 900 111-00-01');
    // с первого рабочего этапа («Диагностика») назад нельзя
    const first = await semen.post(`/api/orders/${id}/stepback`, { responsibleId: users.isakov, comment: 'Ошибся', dueAt: inDays(1) });
    expect(first.status).toBe(409);
    expect((await semen.get(`/api/orders/${id}`)).body.prevStage).toBeNull();

    await satisfyStageChecks(id);
    const adv = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    expect(adv.status).toBe(200);
    let order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.prevStage.code).toBe('diagnostics');

    // без причины нельзя
    const empty = await semen.post(`/api/orders/${id}/stepback`, { responsibleId: users.isakov, comment: '', dueAt: inDays(1) });
    expect(empty.status).toBe(400);

    const back = await semen.post(`/api/orders/${id}/stepback`, { responsibleId: users.isakov, comment: 'Не проверили блок питания', dueAt: inDays(1) });
    expect(back.status).toBe(200);
    order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.stageCode).toBe('diagnostics');
    expect(order.responsibleId).toBe(users.isakov);
    expect(order.history.some((h: any) => h.kind === 'back' && h.comment === 'Не проверили блок питания')).toBe(true);
    const open = order.tasks.filter((t: any) => t.status === 'open' && t.isStageTask);
    expect(open).toHaveLength(1);
    expect(open[0].stageName).toBe('Диагностика');
    expect(open[0].description).toMatch(/Не проверили блок питания/);
    // задача согласования закрыта
    const approval = order.tasks.find((t: any) => t.stageName === 'Согласование');
    expect(approval.status).not.toBe('open');
    // можно снова идти вперёд
    const again = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    expect(again.status).toBe(200);
  });

  it('из «Готово» назад: итог снимается, выданную заявку не вернуть', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.isakov, '+7 900 111-00-02');
    await satisfyStageChecks(id);
    for (const code of ['approval', 'repair', 'ready']) {
      const r = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage[code], responsibleId: users.semen, dueAt: inDays(1) });
      expect(r.status, code).toBe(200);
    }
    expect((await pool.query('SELECT outcome FROM orders WHERE id = $1', [id])).rows[0].outcome).toBe('repaired');
    const back = await semen.post(`/api/orders/${id}/stepback`, { responsibleId: users.semen, comment: 'Забыли заменить кулер', dueAt: inDays(1) });
    expect(back.status).toBe(200);
    const row = (await pool.query('SELECT outcome FROM orders WHERE id = $1', [id])).rows[0];
    expect(row.outcome).toBeNull();
    // отчёты не считают «отремонтировано» по возвращённому этапу
    const rep = await pool.query(`SELECT count(*)::int AS n FROM order_history WHERE order_id = $1 AND kind = 'stage' AND outcome = 'repaired'`, [id]);
    expect(rep.rows[0].n).toBe(0);

    await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.ready, responsibleId: users.semen, dueAt: inDays(1) });
    const issued = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.issued, responsibleId: users.semen, dueAt: inDays(1), deviceReturned: true });
    expect(issued.status).toBe(200);
    const late = await semen.post(`/api/orders/${id}/stepback`, { responsibleId: users.semen, comment: 'Поздно', dueAt: inDays(1) });
    expect(late.status).toBe(409);
  });
});
