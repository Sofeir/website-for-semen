import { many } from '../db/pool';
import { DEVICE_TITLE } from './sql';

/** Одна запись журнала работ за месяц: то, что сделали для организации. */
export interface MonthWork {
  id: number;
  clientId: number;
  clientName: string;
  kind: 'refill' | 'part' | 'repair' | 'service';
  title: string;
  qty: number;
  amount: number | null;
  ops: string[];
  doneAt: Date;
  orderNumber: string | null;
}

/**
 * Работы за месяц по всем клиентам или по одному. Журнал тот же, что в помесячном отчёте.
 * Пока сотрудники не привыкли записывать сумму в «Записать работу», подставляется согласованная с клиентом сумма заявки
 * (заявки, выданные в этом месяце): она ставится на работу заявки без суммы, а если работ нет, добавляется строкой с названием техники.
 * Если у заявки сумма записана в работах, согласованная не добавляется, чтобы не считать дважды.
 */
export async function loadMonthWorks(range: { from: Date; to: Date }, clientId?: number): Promise<MonthWork[]> {
  const works = await many<MonthWork>(
    `SELECT w.id, w.client_id AS "clientId", c.name AS "clientName", w.kind, w.title, w.qty, w.amount::float8 AS amount,
            coalesce(w.ops, '{}') AS ops, w.done_at AS "doneAt", o.number AS "orderNumber"
       FROM device_works w
       JOIN clients c ON c.id = w.client_id
       LEFT JOIN orders o ON o.id = w.order_id
      WHERE w.done_at >= $1 AND w.done_at < $2 AND ($3::int IS NULL OR w.client_id = $3)
      ORDER BY lower(c.name), w.done_at, w.id`,
    [range.from, range.to, clientId ?? null],
  );
  const agreed = await many<MonthWork>(
    `SELECT -o.id AS id, o.client_id AS "clientId", c.name AS "clientName", 'repair' AS kind,
            coalesce(nullif(${DEVICE_TITLE}, ''), 'Ремонт') AS title, 1 AS qty, o.agreed_sum::float8 AS amount,
            '{}'::text[] AS ops, o.issued_at AS "doneAt", o.number AS "orderNumber"
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       JOIN devices d ON d.id = o.device_id
       JOIN device_types dt ON dt.id = d.device_type_id
       LEFT JOIN brands b ON b.id = d.brand_id
       LEFT JOIN models m ON m.id = d.model_id
      WHERE o.issued_at >= $1 AND o.issued_at < $2 AND ($3::int IS NULL OR o.client_id = $3)
        AND o.agreed_sum IS NOT NULL AND o.agreed_sum > 0
        AND NOT EXISTS (SELECT 1 FROM device_works x WHERE x.order_id = o.id AND x.amount IS NOT NULL)`,
    [range.from, range.to, clientId ?? null],
  );
  for (const a of agreed) {
    const own = works.find((w) => w.orderNumber === a.orderNumber && w.amount === null);
    if (own) own.amount = a.amount;
    else works.push(a);
  }
  return works.sort(
    (x, y) => x.clientName.toLowerCase().localeCompare(y.clientName.toLowerCase(), 'ru') || x.doneAt.getTime() - y.doneAt.getTime() || x.id - y.id,
  );
}

/** «ТК-1150 - 2 шт»: картриджи всегда с количеством, остальное — когда штук больше одной. Названия операций (refill, chip и т.п.) в выгрузку не попадают. */
export function workLine(w: Pick<MonthWork, 'kind' | 'title' | 'qty'>): string {
  const qty = w.kind === 'refill' || w.qty > 1 ? ` - ${w.qty} шт` : '';
  return `${w.title.trim()}${qty}`;
}

/** Одинаковые работы (то же название) складываются в одну запись с суммарным количеством. */
export function groupWorks(works: MonthWork[]): MonthWork[] {
  const map = new Map<string, MonthWork>();
  for (const w of works) {
    const key = [w.kind, w.title.trim().toLowerCase()].join('\u0000');
    const prev = map.get(key);
    if (prev) {
      prev.qty += w.qty;
      prev.amount = prev.amount === null && w.amount === null ? null : (prev.amount ?? 0) + (w.amount ?? 0);
    } else map.set(key, { ...w });
  }
  return [...map.values()];
}

/** Все работы организации одной строкой через запятую, как в их таблице «Картриджи, ремонты». */
export function worksText(works: MonthWork[]): string {
  return groupWorks(works).map(workLine).join(', ');
}

export const sumAmount = (works: Pick<MonthWork, 'amount'>[]) => Math.round(works.reduce((s, w) => s + (w.amount ?? 0), 0) * 100) / 100;
