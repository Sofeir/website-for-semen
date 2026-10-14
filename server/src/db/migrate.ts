import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Применяет по порядку файлы migrations/NNN_*.sql, которых ещё нет в schema_migrations. */
export async function migrate(log = true) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const done = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      if (log) console.log(`✓ миграция ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Миграция ${file} не применилась: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
