import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { channels } from './notify/channels';
import { startMaxBot } from './notify/maxBot';
import { runServicePlansSoon } from './services/servicePlans';
import { notifyOverdueSoon } from './services/overdue';

async function main() {
  await migrate();
  const app = createApp();
  // плановые выезды: задачи ставятся накануне, проверяем каждые 10 минут
  void runServicePlansSoon();
  setInterval(() => void runServicePlansSoon(), 10 * 60_000).unref();
  void notifyOverdueSoon();
  setInterval(() => void notifyOverdueSoon(), 5 * 60_000).unref();
  app.listen(config.port, () => {
    const enabled = channels.filter((c) => c.isEnabled()).map((c) => c.label);
    console.log(`API: http://localhost:${config.port}  (внешние уведомления: ${enabled.join(', ') || 'выключены'})`);
  });
  startMaxBot();
}

main().catch(async (e) => {
  console.error('Сервер не запустился:', e.message);
  if (/ECONNREFUSED|password authentication|does not exist/.test(e.message)) {
    console.error('Проверьте DATABASE_URL в .env и что PostgreSQL запущен.');
  }
  await pool.end().catch(() => {});
  process.exit(1);
});
