// Выгрузка всей браузерной базы в один SQL-файл для переноса на сервер с обычным PostgreSQL.
// Файл содержит схему (все миграции) и все данные. Запускается одной командой через psql или в pgAdmin.
import { getDb } from './pg-shim';

const migrations = import.meta.glob('../../../server/src/db/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** Таблицы, которые не переносим: вход заново, миграции пишем сами. */
const SKIP = new Set(['schema_migrations', 'sessions']);

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Порядок таблиц так, чтобы родители шли раньше детей (по внешним ключам). */
function sortByDependencies(tables: string[], deps: Map<string, Set<string>>) {
  const result: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...(deps.get(t) ?? [])].every((d) => d === t || !left.has(d)));
    const batch = ready.length ? ready : [...left].slice(0, 1);
    for (const t of batch) {
      result.push(t);
      left.delete(t);
    }
  }
  return result;
}

export async function buildSqlExport(): Promise<{ sql: string; counts: Record<string, number> }> {
  const db = await getDb();
  const tablesRes = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const tables = tablesRes.rows.map((r) => r.table_name).filter((t) => !SKIP.has(t));

  const fk = await db.query<{ child: string; parent: string }>(
    `SELECT cl.relname AS child, cp.relname AS parent
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_class cp ON cp.oid = c.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const deps = new Map<string, Set<string>>();
  for (const r of fk.rows) {
    if (!deps.has(r.child)) deps.set(r.child, new Set());
    deps.get(r.child)!.add(r.parent);
  }
  const ordered = sortByDependencies(tables, deps);

  const body = (await db.query<{ v: string }>(`SELECT string_agg(version, ',' ORDER BY version) AS v FROM schema_migrations`)).rows[0]?.v ?? '';
  const out: string[] = [];
  out.push('-- ASOFT Сервис: полная выгрузка базы (схема и данные).');
  out.push(`-- Дата выгрузки: ${new Date().toISOString()}`);
  out.push(`-- Миграции: ${body}`);
  out.push('-- Запуск на пустой базе: psql -U postgres -d servicedesk -v ON_ERROR_STOP=1 -f этот_файл.sql');
  out.push('BEGIN;');
  out.push('SET LOCAL client_min_messages = warning;');
  out.push('CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());');

  const done = new Set(body.split(',').filter(Boolean));
  for (const [path, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.split('/').pop()!;
    if (!done.has(file)) continue;
    out.push(`-- миграция ${file}`);
    out.push(sql.trim());
    out.push(`INSERT INTO schema_migrations(version) VALUES ('${file}');`);
  }

  // Миграции кладут в таблицы справочники. Они тоже есть в выгрузке, поэтому сначала очищаем.
  // Таблицы ссылаются друг на друга по кругу (сотрудник-заказчик и клиент), поэтому внешние ключи на время загрузки
  // снимаем и возвращаем в конце. Возврат заново проверяет все связи: если в данных ошибка, загрузка откатится целиком.
  out.push('-- данные');
  out.push(`CREATE TEMP TABLE _fk ON COMMIT DROP AS
  SELECT c.conrelid::regclass::text AS tbl, c.conname AS name, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace;
DO $fk$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM _fk LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.name); END LOOP;
END $fk$;`);
  out.push(`TRUNCATE ${ordered.map(ident).join(', ')} RESTART IDENTITY CASCADE;`);

  const counts: Record<string, number> = {};
  const tag = `j${Math.random().toString(36).slice(2, 10)}`;
  for (const t of ordered) {
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
      [t],
    );
    const list = cols.rows.map((c) => ident(c.column_name)).join(', ');
    const data = (await db.query<{ j: string; n: number }>(`SELECT coalesce(json_agg(x), '[]')::text AS j, count(*)::int AS n FROM ${ident(t)} x`)).rows[0];
    counts[t] = Number(data.n);
    if (!counts[t]) continue;
    if (data.j.includes(`$${tag}$`)) throw new Error('Не удалось собрать выгрузку: в данных встретился служебный разделитель. Повторите.');
    out.push(
      `INSERT INTO ${ident(t)} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${ident(t)}, $${tag}$${data.j}$${tag}$::json);`,
    );
  }

  out.push(`DO $fk$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM _fk LOOP EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.name, r.def); END LOOP;
END $fk$;`);

  // Счётчики автонумерации ставим после последнего номера, иначе новые записи получат занятые номера.
  out.push(`DO $fix$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS col, pg_get_serial_sequence(format('%I', c.table_name), c.column_name) AS seq
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
  LOOP
    IF r.seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)', r.seq, r.col, r.t);
    END IF;
  END LOOP;
END
$fix$;`);
  out.push('COMMIT;');
  out.push('');
  return { sql: out.join('\n'), counts };
}

/** Собирает файл и отдаёт его браузеру на скачивание. Возвращает число строк по таблицам. */
export async function downloadSqlExport() {
  const { sql, counts } = await buildSqlExport();
  const blob = new Blob([sql], { type: 'application/sql;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `asoft-servicedesk-${new Date().toISOString().slice(0, 10)}.sql`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return counts;
}
