import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { channels } from './notify/channels';

async function main() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => {
    const enabled = channels.filter((c) => c.isEnabled()).map((c) => c.label);
    console.log(`API: http://localhost:${config.port}  (внешние уведомления: ${enabled.join(', ') || 'выключены'})`);
  });
}

main().catch(async (e) => {
  console.error('Сервер не запустился:', e.message);
  if (/ECONNREFUSED|password authentication|does not exist/.test(e.message)) {
    console.error('Проверьте DATABASE_URL в .env и что PostgreSQL запущен.');
  }
  await pool.end().catch(() => {});
  process.exit(1);
});
