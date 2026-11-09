import { many } from '../db/pool';

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

/** Работы за месяц по всем клиентам или по одному. Журнал тот же, что в помесячном отчёте. */
export async function loadMonthWorks(range: { from: Date; to: Date }, clientId?: number): Promise<MonthWork[]> {
  return many<MonthWork>(
    `SELECT w.id, w.client_id AS "clientId", c.name AS "clientName", w.kind, w.title, w.qty, w.amount::float8 AS amount,
            coalesce(w.ops, '{}') AS ops, w.done_at AS "doneAt", o.number AS "orderNumber"
       FROM device_works w
       JOIN clients c ON c.id = w.client_id
       LEFT JOIN orders o ON o.id = w.order_id
      WHERE w.done_at >= $1 AND w.done_at < $2 AND ($3::int IS NULL OR w.client_id = $3)
      ORDER BY lower(c.name), w.done_at, w.id`,
    [range.from, range.to, clientId ?? null],
  );
}

/** «ТК-1150 - 2 шт (замена ролика)»: картриджи всегда с количеством, остальное — когда штук больше одной. */
export function workLine(w: Pick<MonthWork, 'kind' | 'title' | 'qty' | 'ops'>): string {
  const qty = w.kind === 'refill' || w.qty > 1 ? ` - ${w.qty} шт` : '';
  const ops = w.ops.length ? ` (${w.ops.join(', ')})` : '';
  return `${w.title.trim()}${qty}${ops}`;
}

/** Одинаковые работы (то же название и те же операции) складываются в одну запись с суммарным количеством. */
export function groupWorks(works: MonthWork[]): MonthWork[] {
  const map = new Map<string, MonthWork>();
  for (const w of works) {
    const key = [w.kind, w.title.trim().toLowerCase(), [...w.ops].sort().join('|')].join('\u0000');
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
