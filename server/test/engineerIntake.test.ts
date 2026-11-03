import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { dict, inDays, loginAs, resetDb } from './helpers';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('приём техники инженером', () => {
  it('парк техники существующей организации инженер не переписывает, при новой организации можно', async () => {
    const { laptop, users } = await dict();
    const admin = await loginAs('golenkov');
    const org = await admin.post('/api/clients', { kind: 'legal', name: 'ООО Тест', phone: '+79000000077', inn: '7707083893' });
    expect(org.status).toBe(201);
    const stas = await loginAs('isakov');
    const base = {
      clientKind: 'legal',
      devices: [{ device: { deviceTypeId: laptop, serial: 'SN-FLEET-1' }, faultText: 'x' }],
      responsibleId: users.isakov,
      dueAt: inDays(1),
      fleet: [{ department: 'Бухгалтерия', pcCount: 3, mfuCount: 1 }],
    };
    const denied = await stas.post('/api/intake', { ...base, clientId: org.body.id });
    expect(denied.status).toBe(403);
    const plain = await stas.post('/api/intake', { ...base, clientId: org.body.id, fleet: null });
    expect(plain.status).toBe(201);
  });
});
