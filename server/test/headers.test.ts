import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { loginAs } from './helpers';

describe('заголовки безопасности по http', () => {
  afterAll(() => pool.end());

  it('без https браузеру не велят переписывать адреса на https и запоминать «только https»', async () => {
    const semen = await loginAs('semen');
    const res = await semen.get('/api/health');
    const csp = String(res.headers['content-security-policy'] ?? '');
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
