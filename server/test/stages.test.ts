import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Stage } from '@sd/shared';
import { pool } from '../src/db/pool';
import { nextStageOf } from '../src/services/orders';
import { dict, inDays, intakeLaptop, loginAs, resetDb } from './helpers';

const st = (id: number, sort: number, isFinal = false): Stage => ({
  id,
  code: `s${id}`,
  name: `Этап ${id}`,
  sort,
  color: 'blue',
  slaHours: 24,
  isFinal,
  isActive: true,
});

describe('порядок этапов', () => {
  it('следующий этап — ближайший по порядку, после финального ничего', () => {
    const stages = [st(1, 10), st(2, 20), st(3, 30, true)];
    expect(nextStageOf(stages, 1)?.id).toBe(2);
    expect(nextStageOf(stages, 2)?.id).toBe(3);
    expect(nextStageOf(stages, 3)).toBeNull();
    expect(nextStageOf(stages, 99)).toBeNull();
  });
});

describe('переходы заявки по API', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('приём сразу закрывает «Приём», ставит «Диагностику» и задачу ответственному', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas);
    const order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.stageId).toBe(stage.diagnostics);
    expect(order.responsibleId).toBe(users.stas);
    expect(order.history.map((h: any) => h.stageCode)).toEqual(['intake', 'diagnostics']);
    expect(order.tasks).toHaveLength(1);
    expect(order.tasks[0].assigneeId).toBe(users.stas);
    const note = await pool.query(`SELECT title FROM notifications WHERE user_id = $1`, [users.stas]);
    expect(note.rows.some((r) => r.title.startsWith('Новая задача: Диагностика'))).toBe(true);
  });

  it('перескочить этап нельзя', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-02');
    const res = await semen.post(`/api/orders/${id}/advance`, {
      toStageId: stage.repair,
      responsibleId: users.lenya,
      dueAt: inDays(2),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/строго по порядку/);
    expect(res.body.nextStageId).toBe(stage.approval);
  });

  it('чужую заявку диагност не двигает, свою — двигает', async () => {
    const semen = await loginAs('semen');
    const olga = await loginAs('olga');
    const stas = await loginAs('stas');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-03');
    const denied = await olga.post(`/api/orders/${id}/advance`, {
      toStageId: stage.approval,
      responsibleId: users.semen,
      dueAt: inDays(1),
    });
    expect(denied.status).toBe(403);
    const ok = await stas.post(`/api/orders/${id}/advance`, {
      toStageId: stage.approval,
      responsibleId: users.semen,
      dueAt: inDays(1),
      comment: 'Нужна матрица',
    });
    expect(ok.status).toBe(200);
    // Задачу ставил Семён, закрыл Стас — Семён получает уведомление с комментарием.
    const note = await pool.query(`SELECT title, body FROM notifications WHERE user_id = $1 AND type = 'task_closed'`, [
      users.semen,
    ]);
    expect(note.rows.some((r) => /Нужна матрица/.test(r.body ?? ''))).toBe(true);
  });

  it('выдать без отметки «техника возвращена» нельзя', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-14');
    for (const code of ['approval', 'repair', 'ready']) {
      await semen.post(`/api/orders/${id}/advance`, { toStageId: stage[code], responsibleId: users.semen, dueAt: inDays(1) });
    }
    const r = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.issued, responsibleId: users.semen });
    expect(r.status).toBe(400);
  });

  it('отказ на согласовании: из согласования сразу в «Готово», итог — без ремонта', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-15');
    await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.approval, responsibleId: users.semen, dueAt: inDays(1) });
    const r = await semen.post(`/api/orders/${id}/advance`, {
      toStageId: stage.ready,
      responsibleId: users.semen,
      dueAt: inDays(1),
      declined: true,
    });
    expect(r.status).toBe(200);
    const order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.stageCode).toBe('ready');
    expect(order.outcome).toBe('declined');
  });

  it('гарантийный возврат открывает ту же заявку заново', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-16');
    for (const code of ['approval', 'repair', 'ready', 'issued']) {
      await semen.post(`/api/orders/${id}/advance`, {
        toStageId: stage[code],
        responsibleId: users.semen,
        dueAt: inDays(1),
        deviceReturned: code === 'issued' ? true : undefined,
      });
    }
    const r = await semen.post(`/api/orders/${id}/reopen`, { reason: 'warranty', responsibleId: users.stas, dueAt: inDays(1) });
    expect(r.status).toBe(200);
    const order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.issuedAt).toBeNull();
    expect(order.reopenCount).toBe(1);
    expect(order.stageCode).toBe('diagnostics');
    expect(order.history.some((h: any) => h.kind === 'reopen')).toBe(true);
    // открытую заявку заново не открыть
    const again = await semen.post(`/api/orders/${id}/reopen`, { reason: 'warranty', responsibleId: users.stas, dueAt: inDays(1) });
    expect(again.status).toBe(409);
  });

  it('передача без причины отклоняется', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-17');
    const r = await semen.post(`/api/orders/${id}/reassign`, { responsibleId: users.lenya, comment: '' });
    expect(r.status).toBe(400);
  });

  it('полный путь до выдачи; выданную заявку дальше не двигаем', async () => {
    const semen = await loginAs('semen');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-04');
    for (const code of ['approval', 'repair', 'ready', 'issued']) {
      const r = await semen.post(`/api/orders/${id}/advance`, {
        toStageId: stage[code],
        responsibleId: users.semen,
        dueAt: inDays(1),
        deviceReturned: code === 'issued' ? true : undefined,
      });
      expect(r.status, code).toBe(200);
    }
    const order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.issuedAt).not.toBeNull();
    expect(order.deviceReturnedAt).not.toBeNull();
    expect(order.canAdvance).toBe(false);
    const again = await semen.post(`/api/orders/${id}/advance`, { toStageId: stage.issued, responsibleId: users.semen });
    expect(again.status).toBe(409);
    const open = await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE order_id = $1 AND status = 'open'`, [id]);
    expect(open.rows[0].n).toBe(0);
  });

  it('передача диагност → мастер: этап тот же, задача переходит с шагом в цепочке', async () => {
    const semen = await loginAs('semen');
    const stas = await loginAs('stas');
    const { stage, users } = await dict();
    const id = await intakeLaptop(semen, users.stas, '+7 900 000-00-05');
    const r = await stas.post(`/api/orders/${id}/reassign`, { responsibleId: users.lenya, comment: 'Это к мастеру' });
    expect(r.status).toBe(200);
    const order = (await semen.get(`/api/orders/${id}`)).body;
    expect(order.stageId).toBe(stage.diagnostics);
    expect(order.responsibleId).toBe(users.lenya);
    const task = (await semen.get(`/api/tasks/${order.tasks[0].id}`)).body;
    expect(task.assigneeId).toBe(users.lenya);
    expect(task.steps.map((s: any) => s.assigneeId)).toEqual([users.stas, users.lenya]);
  });
});
