import { Router } from 'express';
import type { ClientReport, ClientReportOrder, ClientReportWork, MonthlyReport, ReportRow, ReportTotals } from '@sd/shared';
import { many, one } from '../db/pool';
import { DEVICE_TITLE } from '../services/sql';
import { h, HttpError, intParam } from '../lib/http';
import { requirePermission } from '../auth/session';

export const reportsRouter = Router();

const FIELDS = ['accepted', 'repaired', 'declined', 'refills', 'parts', 'otherWorks'] as const;
const emptyTotals = (): ReportTotals => ({ accepted: 0, repaired: 0, declined: 0, refills: 0, parts: 0, otherWorks: 0 });

export function monthRange(raw: unknown) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw ?? ''));
  if (!m) throw new HttpError(400, 'Месяц нужен в виде 2026-10');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new HttpError(400, 'Месяц от 01 до 12');
  return { from: new Date(y, mo - 1, 1), to: new Date(y, mo, 1) };
}

/**
 * Помесячный отчёт по клиентам. Всё считается из журнала: заявок, истории этапов и журнала работ.
 * Заправка считается по количеству картриджей, а не по числу записей.
 */
reportsRouter.get(
  '/reports/monthly',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const month = String(req.query.month);
    const { from, to } = monthRange(month);
    const rows = await many<ReportRow>(
      `SELECT * FROM (
         SELECT c.id AS "clientId", c.name AS "clientName", c.kind,
           (SELECT count(*) FROM orders o WHERE o.client_id = c.id AND o.created_at >= $1 AND o.created_at < $2)::int AS accepted,
           (SELECT count(*) FROM order_history h JOIN orders o ON o.id = h.order_id
             WHERE o.client_id = c.id AND h.kind = 'stage' AND h.outcome = 'repaired' AND h.started_at >= $1 AND h.started_at < $2)::int AS repaired,
           (SELECT count(*) FROM order_history h JOIN orders o ON o.id = h.order_id
             WHERE o.client_id = c.id AND h.kind = 'stage' AND h.outcome = 'declined' AND h.started_at >= $1 AND h.started_at < $2)::int AS declined,
           coalesce((SELECT sum(w.qty) FROM device_works w WHERE w.client_id = c.id AND w.kind = 'refill' AND w.done_at >= $1 AND w.done_at < $2), 0)::int AS refills,
           coalesce((SELECT sum(w.qty) FROM device_works w WHERE w.client_id = c.id AND w.kind = 'part' AND w.done_at >= $1 AND w.done_at < $2), 0)::int AS parts,
           (SELECT count(*) FROM device_works w WHERE w.client_id = c.id AND w.kind IN ('repair', 'service') AND w.done_at >= $1 AND w.done_at < $2)::int AS "otherWorks",
           (SELECT count(*) FROM devices d WHERE d.client_id = c.id)::int AS devices
           FROM clients c
       ) r
       WHERE accepted + repaired + declined + refills + parts + "otherWorks" > 0
       ORDER BY "clientName"`,
      [from, to],
    );
    const totals = { all: emptyTotals(), legal: emptyTotals(), person: emptyTotals() };
    for (const r of rows) {
      for (const f of FIELDS) {
        totals.all[f] += r[f];
        totals[r.kind][f] += r[f];
      }
    }
    const report: MonthlyReport = { month, rows, totals };
    res.json(report);
  }),
);

/** Подробности по одной организации за месяц: что именно сделали. Для выставления счёта. */
reportsRouter.get(
  '/reports/client/:id',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const month = String(req.query.month);
    const { from, to } = monthRange(month);
    const client = await one<{ name: string; kind: 'person' | 'legal' }>('SELECT name, kind FROM clients WHERE id = $1', [id]);
    if (!client) throw new HttpError(404, 'Клиент не найден');

    const works = await many<ClientReportWork>(
      `SELECT w.id, w.kind, w.title, w.qty, w.counter, w.done_at AS "doneAt",
              CASE WHEN d.id IS NULL THEN NULL
                   ELSE concat_ws(' ', nullif(d.inventory_no, ''), ${DEVICE_TITLE}) END AS "deviceTitle"
         FROM device_works w
         LEFT JOIN devices d ON d.id = w.device_id
         LEFT JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
        WHERE w.client_id = $1 AND w.done_at >= $2 AND w.done_at < $3
        ORDER BY w.done_at, w.id`,
      [id, from, to],
    );
    const orders = await many<ClientReportOrder>(
      `SELECT o.id, o.number, ${DEVICE_TITLE} AS "deviceTitle", h.outcome, h.started_at AS "doneAt"
         FROM order_history h
         JOIN orders o ON o.id = h.order_id
         JOIN devices d ON d.id = o.device_id
         JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
        WHERE o.client_id = $1 AND h.kind = 'stage' AND h.outcome IS NOT NULL AND h.started_at >= $2 AND h.started_at < $3
        ORDER BY h.started_at, o.id`,
      [id, from, to],
    );

    const sums = new Map<string, number>();
    for (const w of works) if (w.kind === 'refill') sums.set(w.title, (sums.get(w.title) ?? 0) + w.qty);
    const report: ClientReport = {
      clientId: id,
      clientName: client.name,
      kind: client.kind,
      month,
      refills: [...sums].map(([title, qty]) => ({ title, qty })),
      works: works.filter((w) => w.kind !== 'refill'),
      orders,
    };
    res.json(report);
  }),
);
