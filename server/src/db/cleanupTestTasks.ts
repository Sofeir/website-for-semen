import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { many, pool, tx } from './pool';

/**
 * Удаление тестовых задач, оставшихся от начального наполнения базы (демо-данные).
 *
 * Тестовые задачи создавались одним махом при первом запуске, поэтому у них почти одинаковое время создания.
 * Задачи, заведённые сотрудниками потом, отстоят от них на часы и дни. Скрипт группирует задачи по времени создания
 * (разрыв больше 3 часов — новая группа) и показывает группы. Ничего не удаляет, пока не указана граница и флаг --delete.
 *
 * Запуск (на сервере): docker compose exec app npm run tasks:cleanup --workspace server -- [--before "2026-10-20 12:00"] [--delete]
 *   без параметров     только список групп и задач, ничего не меняется
 *   --before ДАТА      выбрать задачи, созданные раньше этого момента (время сервера)
 *   --ids 68,69,106    выбрать задачи по номерам (№ из списка); можно вместе с --before
 *   --delete           удалить выбранные задачи вместе с их файлами, шагами цепочки и уведомлениями о них
 * Заявки, клиенты и техника не удаляются: скрипт только показывает номера заявок, к которым привязаны задачи.
 */

interface Row {
  id: number;
  title: string;
  status: string;
  created_at: Date;
  creator: string;
  assignees: string | null;
  order_number: string | null;
  is_stage: boolean;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const fmt = (d: Date) => d.toLocaleString('ru-RU', { timeZone: config.timezone });

async function main() {
  const rows = await many<Row>(
    `SELECT t.id, t.title, t.status, t.created_at, u.full_name AS creator, o.number AS order_number, (t.stage_id IS NOT NULL) AS is_stage,
            (SELECT string_agg(a.full_name, ', ' ORDER BY a.full_name) FROM task_assignees ta JOIN users a ON a.id = ta.user_id WHERE ta.task_id = t.id) AS assignees
       FROM tasks t
       JOIN users u ON u.id = t.creator_id
       LEFT JOIN orders o ON o.id = t.order_id
      ORDER BY t.created_at, t.id`,
  );
  if (!rows.length) {
    console.log('Задач нет.');
    return;
  }

  const before = value('--before');
  const idList = (value('--ids') ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
  if (before || idList.length) {
    const limit = before ? new Date(before.replace(' ', 'T')) : null;
    if (limit && Number.isNaN(limit.getTime())) throw new Error(`Не понял дату «${before}». Пример: --before "2026-10-20 12:00"`);
    const isPicked = (r: Row) => Boolean((limit && r.created_at < limit) || idList.includes(r.id));
    const picked = rows.filter(isPicked);
    const missing = idList.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length) console.log(`Задач с номерами ${missing.join(', ')} нет.\n`);
    console.log(`Выбрано: ${picked.length} из ${rows.length} задач${limit ? ` (создано раньше ${fmt(limit)})` : ''}${idList.length ? ` (по номерам: ${idList.join(', ')})` : ''}.\n`);
    for (const r of picked) {
      console.log(`  №${r.id}  ${fmt(r.created_at)}  [${r.status}]  ${r.title}  (поставил: ${r.creator}; исполнитель: ${r.assignees ?? '—'}${r.order_number ? `; заявка №${r.order_number}` : ''})`);
    }
    const kept = rows.filter((r) => !isPicked(r));
    console.log(`\nОстанутся: ${kept.length} задач (самая ранняя из них создана ${kept.length ? fmt(kept[0].created_at) : '—'}).`);
    if (!flag('--delete')) {
      console.log('\nЭто просмотр. Чтобы удалить перечисленные задачи, добавьте флаг --delete.');
      return;
    }
    if (!picked.length) return;
    const ids = picked.map((r) => r.id);
    const files = await tx(async (db) => {
      const stored = await many<{ stored_name: string }>('SELECT stored_name FROM attachments WHERE task_id = ANY ($1)', [ids], db);
      await db.query('DELETE FROM attachments WHERE task_id = ANY ($1)', [ids]);
      await db.query(
        `DELETE FROM notifications WHERE link = ANY ($1)`,
        [ids.map((id) => `/tasks?task=${id}`)],
      );
      await db.query(`DELETE FROM reminders_sent WHERE kind = 'task' AND ref_id = ANY ($1)`, [ids]);
      await db.query('DELETE FROM tasks WHERE id = ANY ($1)', [ids]);
      return stored.map((s) => s.stored_name);
    });
    for (const f of files) fs.rmSync(path.join(config.uploadDir, path.basename(f)), { force: true });
    console.log(`\nУдалено задач: ${ids.length}.`);
    return;
  }

  // Группы по времени создания
  const groups: Row[][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && r.created_at.getTime() - last[last.length - 1].created_at.getTime() <= 3 * 3600_000) last.push(r);
    else groups.push([r]);
  }
  console.log(`Всего задач: ${rows.length}. Групп по времени создания: ${groups.length}.\n`);
  groups.forEach((g, i) => {
    console.log(`Группа ${i + 1}: ${g.length} задач, создано с ${fmt(g[0].created_at)} по ${fmt(g[g.length - 1].created_at)}`);
    for (const r of g.slice(0, 12)) {
      console.log(`  №${r.id}  [${r.status}]  ${r.title}  (поставил: ${r.creator}${r.order_number ? `; заявка №${r.order_number}` : ''})`);
    }
    if (g.length > 12) console.log(`  … и ещё ${g.length - 12}`);
    console.log('');
  });
  console.log('Тестовые задачи — обычно первая группа (создана при начальном наполнении базы).');
  console.log('Проверьте список и запустите с границей: --before "ДАТА ВРЕМЯ" (сначала без --delete, потом с ним).');
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
