import { config } from '../config';
import { pool } from './pool';

/** Полностью очищает базу из DATABASE_URL. Потом: npm run db:seed. */
async function main() {
  if (config.isProd) throw new Error('В продакшене сброс базы запрещён');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('✓ база очищена. Запустите npm run db:seed');
  await pool.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
