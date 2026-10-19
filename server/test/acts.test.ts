import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actTotal } from '@sd/shared';
import { pool } from '../src/db/pool';
import { rublesInWords } from '../src/documents/templates/common';
import { dict, intakeLaptop, loginAs, resetDb } from './helpers';

describe('расчёт акта', () => {
  it('сумма строк без ошибок плавающей точки', () => {
    expect(actTotal([{ qty: 3, price: 0.1 }])).toBe(0.3);
    expect(
      actTotal([
        { qty: 1, price: 1500 },
        { qty: 2, price: 450.5 },
        { qty: 1.5, price: 1000 },
      ]),
    ).toBe(3901);
    expect(actTotal([])).toBe(0);
  });

  it('сумма прописью', () => {
    expect(rublesInWords(1450)).toBe('Одна тысяча четыреста пятьдесят рублей 00 копеек');
    expect(rublesInWords(21.05)).toBe('Двадцать один рубль 05 копеек');
    expect(rublesInWords(2000000)).toBe('Два миллиона рублей 00 копеек');
  });
});

describe('акты по API', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it('несколько работ, правка пересчитывает итог, PDF собирается', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas);
    const svc = (await pool.query(`SELECT id, name, price FROM services WHERE name LIKE 'Замена матрицы%'`)).rows[0];
    const created = await semen.post('/api/acts', {
      orderId,
      items: [
        { serviceId: svc.id, name: svc.name, qty: 1, price: 4200 },
        { serviceId: null, name: 'Матрица 15.6"', qty: 1, price: 5600 },
      ],
      warrantyMonths: 1,
      printRepeatDiscount: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.total).toBe(9800);
    expect(created.body.items).toHaveLength(2);

    const updated = await semen.put(`/api/acts/${created.body.id}`, {
      orderId,
      items: [...created.body.items, { serviceId: null, name: 'Чистка', qty: 2, price: 250 }],
      warrantyMonths: 3,
      printRepeatDiscount: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.total).toBe(10300);
    expect(updated.body.warrantyMonths).toBe(3);
    expect(updated.body.printRepeatDiscount).toBe(true);

    const pdf = await semen.get(`/api/documents/act/${created.body.id}.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('пустой акт не сохраняется', async () => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.stas, '+7 900 000-00-11');
    const res = await semen.post('/api/acts', { orderId, items: [], warrantyMonths: 1 });
    expect(res.status).toBe(400);
  });

  it('удалять акт может руководитель, а мастер — нет', async () => {
    const semen = await loginAs('semen');
    const lenya = await loginAs('lenya');
    const { users } = await dict();
    const orderId = await intakeLaptop(semen, users.lenya, '+7 900 000-00-12');
    const act = await lenya.post('/api/acts', { orderId, items: [{ name: 'Диагностика', qty: 1, price: 0 }], warrantyMonths: 0 });
    expect(act.status).toBe(201);
    expect((await lenya.del(`/api/acts/${act.body.id}`)).status).toBe(403);
    expect((await semen.del(`/api/acts/${act.body.id}`)).status).toBe(200);
  });
});
