import { config } from '../config';
import { pool } from './pool';
import { clientsWithoutOrders, deleteClients, deleteOrders, listOrders, orderTasksSplit } from '../services/testDataCleanup';

/**
 * Удаление тестовых заявок, оставшихся от начального наполнения базы (демо-история за год).
 * Вместе с заявкой уходит всё, что от неё зависит: этапы, акты, задачи, записи работ и заправок. Из отчётов они пропадают сами.
 *
 * Запуск (на сервере): docker compose exec app npm run orders:cleanup --workspace server -- [--below 001101] [--delete] [--clients 5,7] [--delete-clients]
 *   без параметров          список заявок по номерам и где в нумерации разрыв
 *   --below НОМЕР           выбрать заявки с номером меньше указанного (настоящие заявки начинаются с этого номера)
 *   --keep-tasks-from ДАТА  задачи этих заявок, созданные с этого момента, не удалять: они отвяжутся от заявки и останутся в списке задач
 *   --delete                удалить выбранные заявки
 *   --clients СПИСОК        номера клиентов (id), которых нужно удалить после чистки заявок: показываются в конце вывода
 *   --delete-clients        подтвердить удаление клиентов из списка --clients
 * Клиентов, у которых остались заявки или есть учётная запись заказчика, скрипт не удаляет никогда.
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fmt = (d: Date) => d.toLocaleString('ru-RU', { timeZone: config.timezone });

async function main() {
  const orders = await listOrders();
  if (!orders.length) console.log('Заявок нет.');

  const below = value('--below');
  if (below) {
    const limit = Number(below.replace(/^0+/, ''));
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Не понял номер «${below}». Пример: --below 001101`);
    const picked = orders.filter((o) => Number(o.number) < limit);
    const kept = orders.filter((o) => Number(o.number) >= limit);
    const keepRaw = value('--keep-tasks-from');
    const keepFrom = keepRaw ? new Date(keepRaw.replace(' ', 'T')) : null;
    if (keepFrom && Number.isNaN(keepFrom.getTime())) throw new Error(`Не понял дату «${keepRaw}». Пример: --keep-tasks-from "2026-11-02 00:00"`);
    const split = await orderTasksSplit(picked.map((o) => o.id), keepFrom);
    console.log(`Заявок с номером меньше ${below}: ${picked.length} из ${orders.length}.\n`);
    for (const o of picked) console.log(`  №${o.number}  ${fmt(o.createdAt)}  [${o.stage}]  ${o.client}: ${o.device}`);
    console.log(`\nЗадач этих заявок уйдёт вместе с ними: ${split.remove}. Останется (отвяжутся от заявки): ${split.keep}.`);
    console.log(`Заявок останется: ${kept.length}. Первая из них: ${kept[0] ? `№${kept[0].number} (${fmt(kept[0].createdAt)}, ${kept[0].client})` : '—'}.`);
    if (!flag('--delete')) {
      console.log('\nЭто просмотр. Проверьте список. Чтобы удалить перечисленные заявки, добавьте флаг --delete.');
    } else if (picked.length) {
      const r = await deleteOrders(picked.map((o) => o.id), { keepTasksFrom: keepFrom });
      console.log(`\nУдалено: заявок ${r.orders}, задач ${r.tasks} (сохранено задач: ${r.keptTasks}), записей работ и заправок ${r.works}, единиц техники ${r.devices}.`);
    }
  } else if (orders.length) {
    console.log(`Всего заявок: ${orders.length}. Первая №${orders[0].number} (${fmt(orders[0].createdAt)}), последняя №${orders[orders.length - 1].number} (${fmt(orders[orders.length - 1].createdAt)}).\n`);
    console.log('Номера и даты создания (показаны места, где даты создания идут с разрывом больше 3 суток):');
    let prev = orders[0];
    console.log(`  №${prev.number}  ${fmt(prev.createdAt)}  ${prev.client}`);
    for (const o of orders.slice(1)) {
      if (o.createdAt.getTime() - prev.createdAt.getTime() > 3 * 86_400_000 && Number(o.number) - Number(prev.number) === 1) {
        console.log(`  …\n  №${prev.number}  ${fmt(prev.createdAt)}  ${prev.client}\n  №${o.number}  ${fmt(o.createdAt)}  ${o.client}   <- разрыв`);
      }
      prev = o;
    }
    console.log(`  №${prev.number}  ${fmt(prev.createdAt)}  ${prev.client}`);
    console.log('\nПоследние 15 заявок:');
    for (const o of orders.slice(-15)) console.log(`  №${o.number}  ${fmt(o.createdAt)}  [${o.stage}]  ${o.client}: ${o.device}`);
    console.log('\nТестовые заявки — те, что идут первыми по номеру. Выберите номер, с которого начинаются настоящие, и запустите: --below НОМЕР');
  }

  const ids = (value('--clients') ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
  if (ids.length) {
    if (!flag('--delete-clients')) {
      console.log(`\nКлиенты к удалению: ${ids.join(', ')}. Это просмотр, добавьте --delete-clients, чтобы удалить.`);
    } else {
      console.log(`\nУдалено клиентов: ${await deleteClients(ids)} из ${ids.length}.`);
    }
  }

  const left = await clientsWithoutOrders();
  console.log(`\nКлиенты без заявок: ${left.length}.`);
  for (const c of left) {
    console.log(`  id ${c.id}  ${c.name}  (техника: ${c.devices}, записей работ: ${c.works}, задач: ${c.tasks}${c.hasAccount ? ', есть учётная запись заказчика — не удаляется' : ''})`);
  }
  if (left.length) console.log('Если среди них есть тестовые, запустите с --clients id,id --delete-clients.');
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
