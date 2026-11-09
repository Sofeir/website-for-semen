import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { notifyDeadlineReminders } from '../src/services/overdue';
import { dict, inDays, loginAs, resetDb } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function notices(login: string, titlePart: string, type?: string) {
  const r = await pool.query(
    `SELECT n.id, n.title, n.is_read FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE u.login = $1 AND n.title LIKE $2 ${type ? 'AND n.type = $3' : ''} ORDER BY n.id`,
    type ? [login, `%${titlePart}%`, type] : [login, `%${titlePart}%`],
  );
  return r.rows;
}

beforeAll(resetDb);
afterAll(() => pool.end());

describe('картриджи без согласования', () => {
  it('приём картриджей: заявка сразу в работе, заправка записана в работы, согласование пропускается', async () => {
    const { users } = await dict();
    const cartridge = (await pool.query(`SELECT id FROM device_types WHERE name = 'Картридж'`)).rows[0].id as number;
    const stas = await loginAs('isakov');
    const res = await stas.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Картриджный клиент', phone: '+7 900 777-00-01' },
      devices: [{ device: { deviceTypeId: cartridge, modelText: 'CF259A' }, cartridge: true, qty: 3, refillOps: ['refill', 'chip'] }],
      responsibleId: users.kataev,
      dueAt: inDays(1),
    });
    expect(res.status).toBe(201);
    const orderId = res.body.orderIds[0];
    const stage = (await pool.query(`SELECT s.code FROM orders o JOIN stages s ON s.id = o.stage_id WHERE o.id = $1`, [orderId])).rows[0];
    expect(stage.code).toBe('repair');
    const work = (await pool.query(`SELECT kind, qty, ops, title FROM device_works WHERE order_id = $1`, [orderId])).rows;
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ kind: 'refill', qty: 3, title: 'CF259A' });
    expect(work[0].ops).toEqual(['refill', 'chip']);

    // из диагностики картридж идёт мимо согласования; ноутбук проходит все этапы
    const semen = await loginAs('semen');
    await pool.query(`UPDATE orders SET stage_id = (SELECT id FROM stages WHERE code = 'diagnostics') WHERE id = $1`, [orderId]);
    expect((await semen.get(`/api/orders/${orderId}`)).body.nextStage.code).toBe('repair');
    const laptop = await (await import('./helpers')).intakeLaptop(semen, users.isakov, '+7 900 777-00-02');
    expect((await semen.get(`/api/orders/${laptop}`)).body.nextStage.code).toBe('approval');
  });

  it('картридж без модели не принимается', async () => {
    const { users } = await dict();
    const cartridge = (await pool.query(`SELECT id FROM device_types WHERE name = 'Картридж'`)).rows[0].id as number;
    const stas = await loginAs('isakov');
    const res = await stas.post('/api/intake', {
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Ещё клиент', phone: '+7 900 777-00-03' },
      devices: [{ device: { deviceTypeId: cartridge }, cartridge: true, qty: 1 }],
      responsibleId: users.kataev,
      dueAt: inDays(1),
    });
    expect(res.status).toBe(400);
  });
});

describe('срок задачи, продление и контроль', () => {
  it('исполнитель просит продлить срок: просьбу получает только директор, подтверждающий просрочку', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const r = await semen.post('/api/tasks', { title: 'Срок продлить', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(r.status).toBe(201);
    const later = inDays(3);
    expect((await stas.post(`/api/tasks/${r.body.id}/extend-request`, { dueAt: later, comment: 'Ждём запчасть' })).status).toBe(200);
    expect(await notices('semen', 'Просят продлить срок: Срок продлить', 'task_extend_request')).toHaveLength(1);
    expect(await notices('leonid', 'Просят продлить срок: Срок продлить')).toHaveLength(0);
    // раньше нынешнего срока просить нечего; посторонний не просит
    expect((await stas.post(`/api/tasks/${r.body.id}/extend-request`, { dueAt: new Date().toISOString(), comment: 'x' })).status).toBe(400);
    const outsider = await loginAs('kataev');
    expect((await outsider.post(`/api/tasks/${r.body.id}/extend-request`, { dueAt: later, comment: 'x' })).status).toBe(403);
    // пока задача не просрочена, исполнитель двигает срок сам, но с причиной; она остаётся в цепочке
    const body = { title: 'Срок продлить', assigneeIds: [users.isakov], startAt: new Date().toISOString(), dueAt: later };
    expect((await stas.put(`/api/tasks/${r.body.id}`, body)).status).toBe(400);
    expect((await stas.put(`/api/tasks/${r.body.id}`, { ...body, dueReason: 'Ждём запчасть' })).status).toBe(200);
    const steps = (await pool.query(`SELECT comment FROM task_steps WHERE task_id = $1 AND comment LIKE 'Срок перенесён%'`, [r.body.id])).rows;
    expect(steps).toEqual([{ comment: 'Срок перенесён: Ждём запчасть' }]);
    // просроченной задаче срок двигает только директор
    await pool.query(`UPDATE tasks SET due_at = now() - interval '2 hours', start_at = now() - interval '3 hours' WHERE id = $1`, [r.body.id]);
    const again = { ...body, startAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), dueAt: inDays(5), dueReason: 'Ещё ждём' };
    expect((await stas.put(`/api/tasks/${r.body.id}`, again)).status).toBe(403);
    expect((await semen.put(`/api/tasks/${r.body.id}`, again)).status).toBe(200);
  });

  it('под контролем: поставленные, наблюдаемые и переданные, но не свои', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const t = await semen.post('/api/tasks', { title: 'Контроль', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    const mine = (await semen.get('/api/tasks?scope=control')).body.map((x: any) => x.id);
    expect(mine).toContain(t.body.id);
    const theirs = (await stas.get('/api/tasks?scope=control')).body.map((x: any) => x.id);
    expect(theirs).not.toContain(t.body.id);
  });

  it('исполнитель правит описание, но не наблюдателей; закрытую задачу не правят', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const r = await semen.post('/api/tasks', { title: 'Правка', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    const due = (await stas.get(`/api/tasks/${r.body.id}`)).body.dueAt;
    const body = { title: 'Правка', description: 'Уточнил', assigneeIds: [users.isakov], watcherIds: [users.kataev], startAt: new Date().toISOString(), dueAt: due };
    expect((await stas.put(`/api/tasks/${r.body.id}`, body)).status).toBe(200);
    expect((await stas.get(`/api/tasks/${r.body.id}`)).body.watcherIds).toEqual([]);
    expect((await semen.put(`/api/tasks/${r.body.id}`, body)).status).toBe(200);
    expect((await semen.get(`/api/tasks/${r.body.id}`)).body.watcherIds).toEqual([users.kataev]);
    await semen.post('/api/tasks/close', { ids: [r.body.id], comment: null });
    expect((await stas.put(`/api/tasks/${r.body.id}`, body)).status).toBe(409);
  });

  it('постановщик меняет ответственных при правке: новым уведомление, снятым тоже, цепочка обновляется; исполнитель не может', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const r = await semen.post('/api/tasks', { title: 'Смена ответственных', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(2) });
    const due = (await semen.get(`/api/tasks/${r.body.id}`)).body.dueAt;
    const body = (ids: number[]) => ({ title: 'Смена ответственных', assigneeIds: ids, startAt: new Date().toISOString(), dueAt: due });
    // исполнитель сам список не меняет
    expect((await stas.put(`/api/tasks/${r.body.id}`, body([users.isakov, users.kataev]))).status).toBe(403);
    // постановщик: добавляет Катаева, потом заменяет Исакова на Тафлевича
    expect((await semen.put(`/api/tasks/${r.body.id}`, body([users.isakov, users.kataev]))).status).toBe(200);
    expect((await semen.get(`/api/tasks/${r.body.id}`)).body.assigneeIds.sort()).toEqual([users.isakov, users.kataev].sort());
    expect((await notices('kataev', 'Вам поручили задачу: Смена ответственных', 'task_assigned')).length).toBe(1);
    expect((await semen.put(`/api/tasks/${r.body.id}`, body([users.kataev, users.golenkov]))).status).toBe(200);
    const after = (await semen.get(`/api/tasks/${r.body.id}`)).body;
    expect(after.assigneeIds.sort()).toEqual([users.kataev, users.golenkov].sort());
    expect([users.kataev, users.golenkov]).toContain(after.assigneeId);
    expect((await notices('isakov', 'Вас сняли с задачи: Смена ответственных')).length).toBe(1);
    expect((await notices('golenkov', 'Вам поручили задачу: Смена ответственных')).length).toBe(1);
    const open = (await pool.query('SELECT assignee_id FROM task_steps WHERE task_id = $1 AND done_at IS NULL', [r.body.id])).rows.map((x) => x.assignee_id);
    expect(open.sort()).toEqual([users.kataev, users.golenkov].sort());
    // снятый не остаётся в цепочке: ни шага, ни следа передачи
    expect((await pool.query('SELECT 1 FROM task_steps WHERE task_id = $1 AND assignee_id = $2', [r.body.id, users.isakov])).rowCount).toBe(0);
    // пустой список нельзя
    expect((await semen.put(`/api/tasks/${r.body.id}`, body([]))).status).toBe(400);
  });

  it('файлы, загруженные до создания задачи, прикрепляются к ней', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const up = await semen.upload('/api/uploads', { name: 'скрин.png', type: 'image/png', data: PNG });
    expect(up.status).toBe(201);
    const r = await semen.post('/api/tasks', {
      title: 'Со скриншотом',
      assigneeId: users.isakov,
      startAt: new Date().toISOString(),
      dueAt: inDays(1),
      attachmentIds: [up.body[0].id],
    });
    expect(r.status).toBe(201);
    const detail = (await semen.get(`/api/tasks/${r.body.id}`)).body;
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0].fileName).toBe('скрин.png');
  });

  it('открытая задача отмечает все уведомления о ней прочитанными', async () => {
    const { users } = await dict();
    const semen = await loginAs('semen');
    const stas = await loginAs('isakov');
    const r = await semen.post('/api/tasks', { title: 'Прочитать', assigneeId: users.isakov, startAt: new Date().toISOString(), dueAt: inDays(1) });
    const link = `/tasks?task=${r.body.id}`;
    // два уведомления об одной задаче
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, link) VALUES ($1, 'task_assigned', 'Ещё одно', $2)`,
      [users.isakov, link],
    );
    expect((await stas.get('/api/notifications?unread=1')).body.items.filter((n: any) => n.link === link).length).toBeGreaterThanOrEqual(2);
    expect((await stas.post('/api/notifications/read', { link })).status).toBe(200);
    expect((await stas.get('/api/notifications?unread=1')).body.items.filter((n: any) => n.link === link)).toHaveLength(0);
  });
});

describe('напоминания и личные события', () => {
  it('сотрудник сам задаёт напоминания: сколько угодно, можно вернуть стандартные', async () => {
    const stas = await loginAs('isakov');
    const std = (await stas.get('/api/me/reminders')).body;
    expect(std).toEqual({ custom: false, minutes: [1440, 120, 15] });
    const put = await stas.put('/api/me/reminders', { minutes: [60, 10, 10, 5, 1] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ custom: true, minutes: [60, 10, 5, 1] });
    expect((await stas.put('/api/me/reminders', { minutes: [0] })).status).toBe(400);
    expect((await stas.put('/api/me/reminders', { minutes: [50000] })).status).toBe(400);
    expect((await stas.del('/api/me/reminders')).body).toEqual({ custom: false, minutes: [1440, 120, 15] });
  });

  it('напоминание приходит по правилам сотрудника, а у других остаются стандартные', async () => {
    const { users } = await dict();
    const stas = await loginAs('isakov');
    await stas.put('/api/me/reminders', { minutes: [30] });
    const r = await pool.query(
      `INSERT INTO tasks (title, creator_id, assignee_id, start_at, due_at, remind_from) VALUES ('Напомнить по правилам', $1, $2, now(), now() + interval '20 minutes', now() - interval '1 day') RETURNING id`,
      [users.golenkov, users.isakov],
    );
    await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING', [r.rows[0].id, users.isakov, users.kataev]);
    await notifyDeadlineReminders();
    // у Исакова одно «за 30 минут»; у Катаева стандартные: за сутки и за 2 часа уже прошли, шлётся ближайшее — «за 2 часа»
    expect(await notices('isakov', 'Через 30 минут крайний срок: Напомнить по правилам')).toHaveLength(1);
    expect(await notices('kataev', 'Через 2 часа крайний срок: Напомнить по правилам')).toHaveLength(1);
    expect(await notices('kataev', 'Через 1 день')).toHaveLength(0);
    await notifyDeadlineReminders();
    expect(await notices('isakov', 'Через 30 минут крайний срок: Напомнить по правилам')).toHaveLength(1);
  });

  it('личное событие видит только его автор и получает напоминание', async () => {
    const stas = await loginAs('isakov');
    const other = await loginAs('kataev');
    const start = new Date(Date.now() + 10 * 60_000).toISOString();
    const made = await stas.post('/api/calendar-events', { title: 'Совещание', note: '', startAt: start });
    expect(made.status).toBe(201);
    expect((await stas.get('/api/calendar-events')).body.map((e: any) => e.title)).toEqual(['Совещание']);
    expect((await other.get('/api/calendar-events')).body).toEqual([]);
    expect((await other.put(`/api/calendar-events/${made.body.id}`, { title: 'Чужое', startAt: start })).status).toBe(404);
    await pool.query(`UPDATE calendar_events SET remind_from = now() - interval '1 day' WHERE id = $1`, [made.body.id]);
    await pool.query(`UPDATE users SET reminders_custom = false WHERE login = 'isakov'`);
    await notifyDeadlineReminders();
    expect(await notices('isakov', 'событие: Совещание')).toHaveLength(1);
    await other.del(`/api/calendar-events/${made.body.id}`);
    expect((await stas.get('/api/calendar-events')).body).toHaveLength(1);
    await stas.del(`/api/calendar-events/${made.body.id}`);
    expect((await stas.get('/api/calendar-events')).body).toEqual([]);
  });
});
