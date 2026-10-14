// Миграции для демо: SQL-файлы сервера подключаются как текст.
import { pool } from '../../../server/src/db/pool';

const files = import.meta.glob('../../../server/src/db/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export async function migrate() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const done = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r: any) => r.version));
  for (const [path, sql] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.split('/').pop()!;
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Миграция ${file} не применилась: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}
