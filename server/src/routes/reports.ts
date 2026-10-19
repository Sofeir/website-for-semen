import { Router } from 'express';
import type { MonthlyReport, ReportRow, ReportTotals } from '@sd/shared';
import { many } from '../db/pool';
import { h, HttpError } from '../lib/http';
import { requirePermission } from '../auth/session';

export const reportsRouter = Router();

const FIELDS = ['accepted', 'repaired', 'declined', 'refills', 'parts', 'otherWorks'] as const;
const emptyTotals = (): ReportTotals => ({ accepted: 0, repaired: 0, declined: 0, refills: 0, parts: 0, otherWorks: 0 });

function monthRange(raw: unknown) {
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
