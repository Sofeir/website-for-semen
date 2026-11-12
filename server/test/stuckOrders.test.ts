import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, intakeLaptop, loginAs, resetDb, satisfyStageChecks } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

/** Как было раньше: задачу этапа закрыли, а заявка осталась на месте. */
async function closeStageTaskOnly(orderId: number, by: number, comment: string) {
  await pool.query(
    `UPDATE tasks SET status = 'done', closed_at = now() + interval '1 second', closed_by = $2, close_comment = $3
      WHERE order_id = $1 AND status = 'open' AND stage_id IS NOT NULL`,
    [orderId, by, comment],
  );
}

describe('застрявшие заявки', () => {
  it('видны руководителю, диагностика и ремонт двигаются сами, согласование и выдача ждут человека', async () => {
    const { users, stage } = await dict();
    const semen = await loginAs('semen');
    const diag = await intakeLaptop(semen, users.isakov, '+7 900 777-20-01');
    await closeStageTaskOnly(diag, users.isakov, 'Нужна замена SSD');

    const appr = await intakeLaptop(semen, users.isakov, '+7 900 777-20-02');
    await semen.post(`/api/orders/${appr}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    await closeStageTaskOnly(appr, users.semen, 'ждём клиента');

    const repair = await intakeLaptop(semen, users.isakov, '+7 900 777-20-03');
    await satisfyStageChecks(repair);
    for (const code of ['approval', 'repair']) await semen.post(`/api/orders/${repair}/advance`, { toStageId: stage[code], responsibleId: users.semen, dueAt: inDays(1) });
    await closeStageTaskOnly(repair, users.kataev, 'Замена SSD 240 дата новый');

    // обычный сотрудник список не видит
    expect((await (await loginAs('kataev')).get('/api/orders/stuck')).status).toBe(403);

    const list = (await semen.get('/api/orders/stuck')).body as any[];
    const byId = new Map(list.map((r) => [r.id, r]));
    expect(byId.get(diag)?.problem).toBeNull();
    expect(byId.get(appr)?.problem).toMatch(/Согласовано/);
    expect(byId.get(repair)?.problem).toBeNull();

    const r = await semen.post('/api/orders/stuck/advance', { ids: [diag, appr, repair] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.advanced.sort()).toEqual([diag, repair].sort());
    expect(r.body.blocked.map((b: any) => b.id)).toEqual([appr]);

    expect((await pool.query('SELECT stage_id, responsible_id FROM orders WHERE id = $1', [diag])).rows[0]).toMatchObject({ stage_id: stage.approval, responsible_id: users.isakov });
    expect((await pool.query('SELECT stage_id, responsible_id FROM orders WHERE id = $1', [repair])).rows[0]).toMatchObject({ stage_id: stage.ready, responsible_id: users.kataev });
    // комментарий закрытия попал в историю заявки
    const hist = (await semen.get(`/api/orders/${repair}`)).body.history as any[];
    expect(hist.some((h) => h.comment === 'Замена SSD 240 дата новый')).toBe(true);
    expect(((await semen.get('/api/orders/stuck')).body as any[]).map((x) => x.id)).toEqual([appr]);
  });
});
