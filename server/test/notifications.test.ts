import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { loginAs, resetDb, dict } from './helpers';

describe('пропущенные всплывающие уведомления', () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  const assign = async (title: string) => {
    const semen = await loginAs('semen');
    const { users } = await dict();
    const r = await semen.post('/api/tasks', {
      title,
      assigneeId: users.lenya,
      startAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(r.status).toBe(201);
    return users.lenya as number;
  };

  it('кого не было на сайте, тому при входе отдаём пропущенное один раз', async () => {
    await assign('Проверить принтер в бухгалтерии');
    const lenya = await loginAs('lenya');
    const first = (await lenya.get('/api/notifications/missed')).body.items;
    expect(first.map((n: any) => n.title).join(' ')).toContain('Проверить принтер в бухгалтерии');
    // повторный вход или вторая вкладка то же самое не получают
    expect((await lenya.get('/api/notifications/missed')).body.items).toHaveLength(0);
    // в ленте и колокольчике уведомление остаётся
    expect((await lenya.get('/api/notifications')).body.unread).toBeGreaterThan(0);
  });

  it('прочитанное и отключённые всплывающие окна не показываются', async () => {
    const lenya = await loginAs('lenya');
    await assign('Сменить картридж');
    await lenya.post('/api/notifications/read', {});
    expect((await lenya.get('/api/notifications/missed')).body.items).toHaveLength(0);

    await assign('Заменить кабель');
    await pool.query(`UPDATE users SET notify_inapp = false WHERE login = 'lenya'`);
    expect((await lenya.get('/api/notifications/missed')).body.items).toHaveLength(0);
    await pool.query(`UPDATE users SET notify_inapp = true WHERE login = 'lenya'`);
  });
});
