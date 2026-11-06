import path from 'node:path';
import { pool } from './pool';
import { importClients, planClientsImport, readCounterparties } from '../services/clientsImport';

/**
 * Добавляет контрагентов из выгрузки 1С (xlsx) в клиенты. Уже существующих клиентов не трогает и не дублирует.
 *
 * Запуск (на сервере): docker compose exec app npm run clients:import --workspace server -- ФАЙЛ.xlsx [--apply] [--all]
 *   без --apply   только просмотр: сколько клиентов добавится, кого пропустят и почему
 *   --apply       добавить клиентов (одной операцией: либо все, либо ни одного)
 *   --all         в просмотре показать и список всех новых клиентов
 * Файл должен быть внутри контейнера: docker compose cp контрагенты.xlsx app:/tmp/kontragenty.xlsx
 * Все контрагенты заводятся как юрлица: название из «Наименования в программе», ИНН и КПП из файла,
 * «Полное наименование» уходит в заметку, если отличается от названия.
 * Клиента пропускают, если его ИНН или название уже есть в базе (или раньше в файле): ИНН у юрлица в сервисе должен быть один.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);

async function main() {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Укажите файл: npm run clients:import --workspace server -- /tmp/kontragenty.xlsx');
  const rows = await readCounterparties(path.resolve(file));
  const plan = await planClientsImport(rows);
  console.log(`Строк в файле: ${rows.length}. Будет добавлено клиентов: ${plan.create.length}. Пропущено как дубли: ${plan.skipped.length}.\n`);

  if (plan.skipped.length) {
    console.log('Пропущены (клиент уже есть, добавьте вручную, если это другая организация):');
    for (const s of plan.skipped) console.log(`  строка ${s.line}: ${s.name} — ${s.reason}`);
    console.log('');
  }
  if (plan.fixed.length) {
    console.log('Добавятся, но с неверным ИНН или КПП в файле (значение записано в заметку клиента):');
    for (const f of plan.fixed) console.log(`  ${f}`);
    console.log('');
  }
  if (flag('--all')) {
    console.log('Новые клиенты:');
    for (const n of plan.create) console.log(`  строка ${n.line}: ${n.name}  ИНН ${n.inn ?? '—'}  КПП ${n.kpp ?? '—'}`);
    console.log('');
  }
  if (!flag('--apply')) {
    console.log('Это просмотр, в базу ничего не записано. Чтобы добавить клиентов, запустите ту же команду с флагом --apply.');
    return;
  }
  console.log(`Добавлено клиентов: ${await importClients(plan)}.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
