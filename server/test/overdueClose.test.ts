import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function overdueTask(creator: string, assigneeId: number) {
  const c = await loginAs(creator);
  const r = await c.post('/api/tasks', { title: 'Просроченная', assigneeId, startAt: new Date().toISOString(), dueAt: inDays(1) });
  expect(r.status).toBe(201);
  await pool.query(`UPDATE tasks SET due_at = now() - interval '1 day' WHERE id = $1`, [r.body.id]);
  return r.body.id as number;
}

describe('закрытие просроченных задач', () => {
  it('исполнитель не закрывает просроченную задачу сам, руководитель закрывает', async () => {
    const { users } = await dict();
    const id = await overdueTask('semen', users.isakov);
    const stas = await loginAs('isakov');
    const denied = await stas.post('/api/tasks/close', { ids: [id], comment: null });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/подтверждени/);
    expect((await pool.query('SELECT status FROM tasks WHERE id = $1', [id])).rows[0].status).toBe('open');

    const semen = await loginAs('semen');
    const ok = await semen.post('/api/tasks/close', { ids: [id], comment: null });
    expect(ok.status).toBe(200);
    expect(ok.body.closed).toEqual([id]);
  });

  it('в пачке просроченные пропускаются и отмечены needConfirm, остальные закрываются', async () => {
    const { users } = await dict();
    const late = await overdueTask('semen', users.isakov);
    const semen = await loginAs('semen');
    const fresh = (await semen.post('/api/tasks', { title: 'Свежая', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) })).body.id;
    const stas = await loginAs('isakov');
    const res = await stas.post('/api/tasks/close', { ids: [late, fresh], comment: null });
    expect(res.status).toBe(200);
    expect(res.body.closed).toEqual([fresh]);
    expect(res.body.needConfirm).toEqual([late]);
  });

  it('запрос подтверждения уходит только тому, кто подтверждает; другие руководители и постановщик не получают, закрыть не могут', async () => {
    const { users } = await dict();
    const id = await overdueTask('maria', users.isakov);
    const stas = await loginAs('isakov');
    const r = await stas.post(`/api/tasks/${id}/close-request`, { comment: 'Диск заменили' });
    expect(r.status).toBe(200);
    const to = (await pool.query(`SELECT user_id FROM notifications WHERE type = 'task_close_request' AND body LIKE '%Диск заменили%'`)).rows.map((x) => x.user_id);
    expect(to).toEqual([users.semen]);

    // администратор с правом видеть все задачи просроченную закрыть тоже не может
    const admin = await loginAs('golenkov');
    expect((await admin.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(403);

    const semen = await loginAs('semen');
    const fresh = (await semen.post('/api/tasks', { title: 'Свежая', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) })).body.id;
    expect((await stas.post(`/api/tasks/${fresh}/close-request`, {})).status).toBe(400);
    expect((await semen.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(200);
  });
});

describe('файлы к задачам', () => {
  it('участник прикрепляет фото, оно видно в задаче, посторонний не видит и не добавляет', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const id = (await semen.post('/api/tasks', { title: 'С фото', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) })).body.id;
    const stas = await loginAs('isakov');
    const up = await stas.upload('/api/uploads', { name: 'схема.png', type: 'image/png', data: PNG }, { taskId: String(id) });
    expect(up.status).toBe(201);
    const detail = await stas.get(`/api/tasks/${id}`);
    expect(detail.body.attachments).toHaveLength(1);
    expect(detail.body.attachments[0].fileName).toBe('схема.png');
    expect((await stas.get(detail.body.attachments[0].url)).status).toBe(200);

    const other = await loginAs('kataev');
    expect((await other.get(detail.body.attachments[0].url)).status).toBe(403);
    expect((await other.upload('/api/uploads', { name: 'x.png', type: 'image/png', data: PNG }, { taskId: String(id) })).status).toBe(403);
  });
});

describe('просрочка при передаче', () => {
  it('переданная просроченная задача остаётся просроченной, закрыть её по-прежнему может только подтверждающий', async () => {
    const { users } = await dict();
    const id = await overdueTask('semen', users.isakov);
    const stas = await loginAs('isakov');
    const t = await stas.post(`/api/tasks/${id}/transfer`, { assigneeId: users.kataev, dueAt: inDays(2), comment: 'Передаю Артёму' });
    expect(t.status).toBe(200);
    const kataev = await loginAs('kataev');
    const detail = await kataev.get(`/api/tasks/${id}`);
    expect(detail.body.overdue).toBe(true);
    expect(new Date(detail.body.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect((await kataev.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(403);
    const semen = await loginAs('semen');
    expect((await semen.post('/api/tasks/close', { ids: [id], comment: null })).status).toBe(200);
  });

  it('постановщик правкой срока просрочку не снимает, подтверждающий снимает', async () => {
    const { users } = await dict();
    const id = await overdueTask('maria', users.isakov);
    const maria = await loginAs('maria');
    const body = { title: 'Просроченная', assigneeIds: [users.isakov], startAt: new Date().toISOString(), dueAt: inDays(3) };
    expect((await maria.put(`/api/tasks/${id}`, body)).status).toBe(200);
    expect((await maria.get(`/api/tasks/${id}`)).body.overdue).toBe(true);
    const semen = await loginAs('semen');
    expect((await semen.put(`/api/tasks/${id}`, body)).status).toBe(200);
    expect((await semen.get(`/api/tasks/${id}`)).body.overdue).toBe(false);
  });
});

describe('наблюдатели задачи', () => {
  it('наблюдатель получает уведомление, видит задачу, но не закрывает; посторонний не видит', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const r = await semen.post('/api/tasks', {
      title: 'С наблюдателем',
      assigneeId: users.isakov,
      watcherIds: [users.kataev],
      startAt: new Date().toISOString(),
      dueAt: inDays(1),
    });
    expect(r.status).toBe(201);
    const id = r.body.id as number;
    expect((await pool.query(`SELECT 1 FROM notifications WHERE type = 'task_watch' AND user_id = $1`, [users.kataev])).rowCount).toBe(1);
    const kataev = await loginAs('kataev');
    const detail = await kataev.get(`/api/tasks/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.watcherIds).toEqual([users.kataev]);
    const watching = await kataev.get('/api/tasks?scope=watching');
    expect(watching.body.map((t: { id: number }) => t.id)).toContain(id);
    expect((await kataev.post('/api/tasks/close', { ids: [id], comment: null })).body.closed).toEqual([]);
    const maria = await loginAs('maria');
    expect((await maria.get(`/api/tasks/${id}`)).status).toBe(403);

    // закрытие доходит и до наблюдателя
    const stas = await loginAs('isakov');
    await stas.post('/api/tasks/close', { ids: [id], comment: 'Сделано' });
    expect((await pool.query(`SELECT 1 FROM notifications WHERE type = 'task_closed' AND user_id = $1 AND title LIKE '%С наблюдателем%'`, [users.kataev])).rowCount).toBe(1);
  });

  it('постановщик меняет наблюдателей при правке', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const id = (await semen.post('/api/tasks', { title: 'Правка', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) })).body.id;
    const body = { title: 'Правка', assigneeIds: [users.isakov], watcherIds: [users.maria], startAt: new Date().toISOString(), dueAt: inDays(1) };
    expect((await semen.put(`/api/tasks/${id}`, body)).status).toBe(200);
    expect((await semen.get(`/api/tasks/${id}`)).body.watcherIds).toEqual([users.maria]);
    expect((await semen.put(`/api/tasks/${id}`, { ...body, watcherIds: [] })).status).toBe(200);
    expect((await semen.get(`/api/tasks/${id}`)).body.watcherIds).toEqual([]);
  });
});
