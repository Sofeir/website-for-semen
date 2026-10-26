import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { intakeLaptop, loginAs, resetDb, dict } from './helpers';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('проверка техники на выезде', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('пункты чек-листов лежат в справочнике, правятся и входят в список', async () => {
    const semen = await loginAs('semen');
    const d = (await semen.get('/api/dictionaries')).body;
    expect(d.inspectPc).toHaveLength(7);
    expect(d.inspectPrinter).toHaveLength(7);
    const add = await semen.post('/api/dictionaries/inspect_pc', { name: 'Проверка принтера по сети' });
    expect(add.status).toBe(201);
    expect((await semen.get('/api/dictionaries')).body.inspectPc).toHaveLength(8);
    // внешний вид и комплектность не задеты
    expect(d.appearance.length).toBeGreaterThan(0);
  });

  it('проверка ноутбука пишется в журнал: очистка отдельной строкой, имя ПК и сотрудник запоминаются', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-31');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const items = [
      { title: 'Проверка антивируса', done: true },
      { title: 'Проверка резервных копий', done: false },
      { title: 'Очистка устройства от пыли', done: true },
    ];
    const r = await semen.post('/api/inspections', {
      deviceId: order.device.id,
      hostName: 'BUH-01',
      personName: 'Иванова Ольга',
      personPhone: '+7 900 111-22-33',
      counter: 5000,
      note: 'Заменить термопасту',
      items,
    });
    expect(r.status).toBe(201);

    const list = (await semen.get(`/api/clients/${order.clientId}/inspections`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'pc', hostName: 'BUH-01', personName: 'Иванова Ольга', counter: null });
    expect(list[0].items).toEqual(items);

    const works = (await semen.get(`/api/devices/${order.device.id}/works`)).body;
    const titles = works.map((w: any) => w.title);
    expect(titles).toContain('Проверка ПК');
    expect(titles).toContain('Очистка устройства от пыли');
    expect(works.find((w: any) => w.title === 'Проверка ПК').note).toContain('Пройдено 2 из 3');
    expect(works.find((w: any) => w.title === 'Проверка ПК').note).toContain('Проверка резервных копий');
  });

  it('техника без чек-листа и чужие мастера не проходят', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-32');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const comp = await semen.post(`/api/devices/${order.device.id}/components`, {
      deviceTypeId: (await pool.query(`SELECT id FROM device_types WHERE name = 'Мониторы'`)).rows[0].id,
      modelText: 'Монитор 27" Samsung',
    });
    expect(comp.status).toBe(201);
    const bad = await semen.post('/api/inspections', { deviceId: comp.body.id, items: [] });
    expect(bad.status).toBe(400);
    const lenya = await loginAs('lenya');
    const denied = await lenya.post('/api/inspections', { deviceId: order.device.id, items: [{ title: 'Проверка антивируса', done: true }] });
    expect(denied.status).toBe(403);
  });

  it('пробег принтера идёт в журнал, PDF формируется', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-33');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const printerType = (await pool.query(`SELECT id FROM device_types WHERE name = 'Принтеры/МФУ'`)).rows[0].id;
    const dev = await semen.post(`/api/devices/${order.device.id}/components`, { deviceTypeId: printerType, modelText: 'Kyocera M2040dn', serial: 'PR1' });
    const r = await semen.post('/api/inspections', {
      deviceId: dev.body.id,
      counter: 81234,
      items: [{ title: 'Проверка состояния фотобарабана', done: true }],
    });
    expect(r.status).toBe(201);
    const works = (await semen.get(`/api/devices/${dev.body.id}/works`)).body;
    expect(works[0]).toMatchObject({ title: 'Проверка МФУ / принтера', counter: 81234 });

    const one = await semen.get(`/api/documents/inspection/${r.body.id}.pdf`);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toContain('application/pdf');
    const month = await semen.get(`/api/documents/inspections/client/${order.clientId}.pdf?month=${thisMonth()}`);
    expect(month.status).toBe(200);
    const blank = await semen.get('/api/documents/inspection-blank/pc.pdf');
    expect(blank.status).toBe(200);
    expect((await semen.get('/api/documents/inspections/client/' + order.clientId + '.pdf?month=2020-01')).status).toBe(404);
  });

  // выезды

  it('закрытый выезд попадает в строку отчёта, подробности клиента и аналитику инженера', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-41');
    const clientId = (await semen.get(`/api/orders/${orderId}`)).body.clientId;
    const day = new Date();
    day.setHours(23, 0, 0, 0);
    const created = await semen.post('/api/tasks', {
      title: 'Выезд: клиент',
      assigneeId: users.lenya,
      clientId,
      startAt: new Date(Date.now() - 3_600_000).toISOString(),
      dueAt: day.toISOString(),
      visit: true,
    });
    expect(created.status).toBe(201);
    const closed = await lenya.post('/api/tasks/close', { ids: [created.body.id], comment: 'Всё проверил' });
    expect(closed.status).toBe(200);

    const report = (await semen.get(`/api/reports/monthly?month=${thisMonth()}`)).body;
    expect(report.rows.find((r: any) => r.clientId === clientId).visits).toBe(1);
    expect(report.totals.all.visits).toBe(1);
    expect(report.totals.legal.visits + report.totals.person.visits).toBe(report.totals.all.visits);

    const detail = (await semen.get(`/api/reports/client/${clientId}?month=${thisMonth()}`)).body;
    expect(detail.totals.visits).toBe(1);
    expect(detail.visits).toHaveLength(1);
    expect(detail.visits[0]).toMatchObject({ title: 'Выезд: клиент', checklistTotal: 0, inspected: 0, closeComment: 'Всё проверил' });
    expect(detail.visits[0].performerName).toContain('Катаев');

    const an = (await semen.get(`/api/analytics?month=${thisMonth()}`)).body;
    expect(an.current.visits).toBe(1);
    expect(an.masters.find((m: any) => m.userId === users.lenya).visits).toBe(1);
    const master = (await semen.get(`/api/analytics/master/${users.lenya}?month=${thisMonth()}`)).body;
    expect(master.visits).toHaveLength(1);
    expect(master.visits[0].clientId).toBe(clientId);
  });

  it('у выезда нет общего чек-листа, что бы ни передали', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-42');
    const clientId = (await semen.get(`/api/orders/${orderId}`)).body.clientId;
    const plan = { title: 'Выезд: клиент', assigneeId: users.lenya, clientId, startAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3_600_000).toISOString(), visit: true };
    const first = await semen.post('/api/tasks', { ...plan, checklist: ['Свой пункт'] });
    expect(first.status).toBe(201);
    expect((await semen.get(`/api/tasks/${first.body.id}`)).body.checklist).toEqual([]);
  });

  it('выезд проверяет технику клиента по одной единице: свой бланк, замечания, доступ инженера', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const stas = await loginAs('stas');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-43');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const clientId = order.clientId;
    const printerType = (await pool.query(`SELECT id FROM device_types WHERE name = 'Принтеры/МФУ'`)).rows[0].id;
    const printer = await semen.post(`/api/devices/${order.device.id}/components`, { deviceTypeId: printerType, modelText: 'Kyocera M2040dn', serial: 'VD1' });
    expect(printer.status).toBe(201);
    await semen.put(`/api/devices/${order.device.id}`, { inventoryNo: 'ПК-1', location: 'Столовая 1', serial: null, parentId: null });
    await semen.put(`/api/devices/${printer.body.id}`, { inventoryNo: 'П-1', location: 'Столовая 1', serial: 'VD1', parentId: null });

    const created = await semen.post('/api/tasks', {
      title: 'Выезд: клиент',
      assigneeId: users.lenya,
      clientId,
      startAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      visit: true,
    });
    expect(created.status).toBe(201);
    const taskId = created.body.id;

    // инженер без своих заявок на этого клиента видит технику выезда
    const list = (await lenya.get(`/api/tasks/${taskId}/visit-devices`)).body;
    expect(list.map((d: any) => d.kind).sort()).toEqual(['pc', 'printer']);
    expect(list.every((d: any) => d.current === null)).toBe(true);
    expect(list.find((d: any) => d.kind === 'pc')).toMatchObject({ inventoryNo: 'ПК-1', location: 'Столовая 1' });
    // посторонний выезд не видит
    expect((await stas.get(`/api/tasks/${taskId}/visit-devices`)).status).toBe(403);

    const pcItems = [
      { title: 'Проверка состояния дисков', done: true, comment: 'Диск в плохом состоянии, заменить' },
      { title: 'Проверка антивируса', done: true },
      { title: 'Проверка резервных копий', done: false, comment: 'Копии не настроены' },
    ];
    // инженер сохраняет проверку внутри выезда, хотя заявок по технике у него нет
    const saved = await lenya.post('/api/inspections', { deviceId: order.device.id, taskId, items: pcItems, hostName: 'KASSA-1' });
    expect(saved.status).toBe(201);
    // а вне выезда чужую технику нельзя
    expect((await lenya.post('/api/inspections', { deviceId: order.device.id, items: pcItems })).status).toBe(403);
    // техника чужого клиента в этот выезд не попадает
    const other = await intakeLaptop(semen, users.stas, '+7 900 000-00-44');
    const otherDevice = (await semen.get(`/api/orders/${other}`)).body.device.id;
    expect((await lenya.post('/api/inspections', { deviceId: otherDevice, taskId, items: pcItems })).status).toBe(400);

    const after = (await lenya.get(`/api/tasks/${taskId}/visit-devices`)).body;
    const pc = after.find((d: any) => d.kind === 'pc');
    expect(pc.current.items[0]).toMatchObject({ comment: 'Диск в плохом состоянии, заменить' });
    expect(pc.current.items[1].comment).toBeUndefined();
    expect(after.find((d: any) => d.kind === 'printer').current).toBeNull();

    // замечания попадают в журнал техники
    const works = (await semen.get(`/api/devices/${order.device.id}/works`)).body;
    expect(works.find((w: any) => w.title === 'Проверка ПК').note).toContain('замечания: Проверка состояния дисков: Диск в плохом состоянии, заменить');

    const closed = await lenya.post('/api/tasks/close', { ids: [taskId], comment: 'Один ПК без копий' });
    expect(closed.status).toBe(200);
    const detail = (await semen.get(`/api/reports/client/${clientId}?month=${thisMonth()}`)).body;
    expect(detail.visits.find((v: any) => v.id === taskId)).toMatchObject({ inspected: 1, checklistTotal: 0 });
    // закрытый выезд не правится
    expect((await lenya.post('/api/inspections', { deviceId: order.device.id, taskId, items: pcItems })).status).toBe(409);
  });

  it('технику клиента добавляет руководитель: номер и отдел, дубль номера не проходит, в выезде она появляется', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const { users } = await dict();
    const c = await semen.post('/api/clients', { kind: 'legal', name: 'ООО Столовая', contactPerson: 'Ольга', phone: '+7 900 200-30-40' });
    expect(c.status).toBe(201);
    const pcType = (await pool.query(`SELECT id FROM device_types WHERE name = 'Компьютер'`)).rows[0].id;
    const add = await semen.post(`/api/clients/${c.body.id}/devices`, { deviceTypeId: pcType, inventoryNo: 'ПК-2', location: 'Столовая 3', hostName: 'KASSA-3', modelText: 'Офисный ПК' });
    expect(add.status).toBe(201);
    expect((await semen.post(`/api/clients/${c.body.id}/devices`, { deviceTypeId: pcType, inventoryNo: 'пк-2' })).status).toBe(409);
    expect((await lenya.post(`/api/clients/${c.body.id}/devices`, { deviceTypeId: pcType, inventoryNo: 'ПК-5' })).status).toBe(403);

    const visit = await semen.post('/api/tasks', {
      title: 'Выезд: ООО Столовая',
      assigneeId: users.lenya,
      clientId: c.body.id,
      startAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      visit: true,
    });
    const list = (await lenya.get(`/api/tasks/${visit.body.id}/visit-devices`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'pc', inventoryNo: 'ПК-2', location: 'Столовая 3', hostName: 'KASSA-3' });
  });

  it('выезд не открывает чужого клиента: свой выезд у инженера и прежний исполнитель доступа не получают', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const stas = await loginAs('stas');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-45');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const when = { startAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3_600_000).toISOString() };
    const items = [{ title: 'Проверка антивируса', done: true }];

    // инженер сам себе ставит «выезд» к клиенту, с которым не работает: ни список техники, ни проверка недоступны
    const own = await lenya.post('/api/tasks', { title: 'Выезд', assigneeId: users.lenya, clientId: order.clientId, visit: true, ...when });
    expect(own.status).toBe(201);
    expect((await lenya.get(`/api/tasks/${own.body.id}/visit-devices`)).status).toBe(403);
    expect((await lenya.post('/api/inspections', { deviceId: order.device.id, taskId: own.body.id, items })).status).toBe(403);

    // выезд поставил руководитель: исполнитель работает, а после передачи прежний исполнитель доступ теряет
    const given = await semen.post('/api/tasks', { title: 'Выезд', assigneeId: users.lenya, clientId: order.clientId, visit: true, ...when });
    expect((await lenya.get(`/api/tasks/${given.body.id}/visit-devices`)).status).toBe(200);
    const moved = await lenya.post(`/api/tasks/${given.body.id}/transfer`, { assigneeId: users.stas, dueAt: when.dueAt, comment: 'Передаю коллеге' });
    expect(moved.status).toBe(200);
    expect((await lenya.get(`/api/tasks/${given.body.id}/visit-devices`)).status).toBe(403);
    expect((await lenya.post('/api/inspections', { deviceId: order.device.id, taskId: given.body.id, items })).status).toBe(403);
    expect((await stas.get(`/api/tasks/${given.body.id}/visit-devices`)).status).toBe(200);
  });
});
