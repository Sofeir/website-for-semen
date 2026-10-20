import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, intakeLaptop, loginAs, resetDb } from './helpers';

describe('люди организаций, серийные номера, согласованное', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  const legal = async (semen: Awaited<ReturnType<typeof loginAs>>, name: string) => {
    const r = await semen.post('/api/clients', { kind: 'legal', name, inn: '', kpp: '' });
    expect(r.status).toBe(201);
    return r.body.id as number;
  };

  it('сотрудник организации: ФИО и телефон обязательны, должность нет, дубль по телефону не пускает', async () => {
    const semen = await loginAs('semen');
    const org = await legal(semen, 'ООО «Тест людей»');
    expect((await semen.post(`/api/clients/${org}/contacts`, { fullName: 'Иван Петров', phone: '' })).status).toBe(400);
    expect((await semen.post(`/api/clients/${org}/contacts`, { fullName: 'И', phone: '+7 900 111-22-33' })).status).toBe(400);
    const ok = await semen.post(`/api/clients/${org}/contacts`, { fullName: 'Иван Петров', phone: '+7 900 111-22-33' });
    expect(ok.status).toBe(201);
    const dup = await semen.post(`/api/clients/${org}/contacts`, { fullName: 'Другой Человек', phone: '8 900 111 22 33', position: 'Бухгалтер' });
    expect(dup.status).toBe(409);
    expect(dup.body.contactId).toBe(ok.body.id);
    const list = (await semen.get(`/api/clients/${org}/contacts?q=петр`)).body;
    expect(list).toHaveLength(1);
    expect(list[0].position).toBeNull();
    // мастер людей организаций не видит
    const lenya = await loginAs('lenya');
    expect((await lenya.get(`/api/clients/${org}/contacts`)).status).toBe(403);
  });

  it('тот же человек как частный клиент: создаётся один раз, связь в обе стороны', async () => {
    const semen = await loginAs('semen');
    const org = await legal(semen, 'ООО «Тест связи»');
    const c = (await semen.post(`/api/clients/${org}/contacts`, { fullName: 'Давыдов Андрей', phone: '+7 900 222-33-44' })).body.id;
    const hits = (await semen.get('/api/contacts/search?q=давыдов')).body;
    expect(hits.some((h: any) => h.id === c && h.clientName === 'ООО «Тест связи»')).toBe(true);
    const p1 = (await semen.post(`/api/contacts/${c}/person`)).body.id;
    const p2 = (await semen.post(`/api/contacts/${c}/person`)).body.id;
    expect(p2).toBe(p1);
    const person = (await semen.get(`/api/clients/${p1}`)).body;
    expect(person.kind).toBe('person');
    // частный клиент становится сотрудником другой организации без повторного ввода
    const other = await legal(semen, 'ООО «Другая организация»');
    const back = (await semen.post(`/api/clients/${other}/contacts/from-person`, { personClientId: p1 })).body.id;
    const again = (await semen.post(`/api/clients/${other}/contacts/from-person`, { personClientId: p1 })).body.id;
    expect(again).toBe(back);
  });

  it('приём от организации с сотрудником: заявка хранит его, поиск находит по ФИО', async () => {
    const semen = await loginAs('semen');
    const { users, laptop } = await dict();
    const org = await legal(semen, 'ООО «Тест приёма»');
    const contact = (await semen.post(`/api/clients/${org}/contacts`, { fullName: 'Чувакова Ольга', phone: '+7 900 333-44-55', position: 'Кассир' })).body.id;
    const body = {
      clientKind: 'legal',
      clientId: org,
      contactId: contact,
      devices: [{ device: { deviceTypeId: laptop, brandText: 'Acer', modelText: 'X', serial: 'SN-CONTACT-1' }, faultIds: [], faultText: 'Не включается', appearance: [], kit: [] }],
      responsibleId: users.stas,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const r = await semen.post('/api/intake', body);
    expect(r.status).toBe(201);
    const order = (await semen.get(`/api/orders/${r.body.orderIds[0]}`)).body;
    expect(order.contact.fullName).toBe('Чувакова Ольга');
    expect(order.contact.position).toBe('Кассир');
    expect(order.requesterName).toBe('Чувакова Ольга');
    const found = (await semen.get('/api/orders?q=чувакова')).body;
    expect(found.some((o: any) => o.id === order.id)).toBe(true);
    // сотрудник чужой организации не подходит
    const other = await legal(semen, 'ООО «Чужая»');
    const bad = await semen.post('/api/intake', { ...body, clientId: other });
    expect(bad.status).toBe(400);
  });

  it('серийный номер у ноутбука обязателен, у компьютера номер присваивается сам', async () => {
    const semen = await loginAs('semen');
    const { users, laptop } = await dict();
    const pcType = (await pool.query(`SELECT id FROM device_types WHERE name = 'Компьютер'`)).rows[0].id;
    const mk = (type: number, serial: string | null, phone: string) => ({
      clientKind: 'person',
      newClient: { kind: 'person', name: 'Тест Серийный', phone },
      devices: [{ device: { deviceTypeId: type, brandText: 'HP', modelText: 'M', serial }, faultIds: [], faultText: 'Не работает', appearance: [], kit: [] }],
      responsibleId: users.stas,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const noSerial = await semen.post('/api/intake', mk(laptop, null, '+7 900 444-00-01'));
    expect(noSerial.status).toBe(400);
    const pc = await semen.post('/api/intake', mk(pcType, null, '+7 900 444-00-02'));
    expect(pc.status).toBe(201);
    const order = (await semen.get(`/api/orders/${pc.body.orderIds[0]}`)).body;
    expect(order.device.inventoryNo).toMatch(/^ПК-\d{4}$/);
  });

  it('согласованные срок и сумма правит ответственный, мастеру чужой заявки нельзя', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-31');
    const stas = await loginAs('stas');
    const ok = await stas.put(`/api/orders/${orderId}/agreed`, { agreedTerm: 'до пятницы', agreedSum: 4500 });
    expect(ok.status).toBe(200);
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    expect(order.agreedTerm).toBe('до пятницы');
    expect(order.agreedSum).toBe(4500);
    const lenya = await loginAs('lenya');
    expect((await lenya.put(`/api/orders/${orderId}/agreed`, { agreedTerm: 'x' })).status).toBe(403);
  });

  it('работа по заявке: исполнитель, сумма, гарантия и расходники видны в карточке', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-32');
    const r = await semen.post('/api/works', {
      orderId, kind: 'part', title: 'Оперативная память', performerId: users.lenya, amount: 3300,
      partBrand: 'Kingston', partSpec: '8 ГБ', warrantyMonths: 12,
    });
    expect(r.status).toBe(201);
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    expect(order.works).toHaveLength(1);
    expect(order.works[0]).toMatchObject({ performerName: 'Катаев Артем Дмитриевич', amount: 3300, partBrand: 'Kingston', warrantyMonths: 12 });
  });

  it('рабочее место: комплектующее входит в состав, чужого клиента нельзя', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-33');
    const order = (await semen.get(`/api/orders/${orderId}`)).body;
    const periph = (await pool.query(`SELECT id FROM device_types WHERE name = 'Периферия'`)).rows[0].id;
    const add = await semen.post(`/api/devices/${order.device.id}/components`, { deviceTypeId: periph, modelText: 'Монитор Samsung 27"' });
    expect(add.status).toBe(201);
    const comps = (await semen.get(`/api/devices/${order.device.id}/components`)).body;
    expect(comps).toHaveLength(1);
    expect(comps[0].parentId).toBe(order.device.id);
    const other = (await semen.get(`/api/orders/${await intakeLaptop(semen, users.stas, '+7 900 000-00-34')}`)).body;
    const bad = await semen.put(`/api/devices/${other.device.id}`, { parentId: order.device.id });
    expect(bad.status).toBe(400);
  });
});
