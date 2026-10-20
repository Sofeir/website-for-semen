import { Router } from 'express';
import type {
  Analytics,
  AnalyticsClient,
  AnalyticsDevice,
  AnalyticsMaster,
  AnalyticsTotals,
  EarlyReplacement,
} from '@sd/shared';
import { many, one } from '../db/pool';
import { DEVICE_TITLE } from '../services/sql';
import { h, HttpError } from '../lib/http';
import { requirePermission } from '../auth/session';
import { monthRange } from './reports';

export const analyticsRouter = Router();

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Итоги за промежуток [from, to): заявки, ремонты, отказы, заправки, работы и деньги. */
async function totals(from: Date, to: Date): Promise<AnalyticsTotals> {
  const r = await one<AnalyticsTotals>(
    `SELECT
       (SELECT count(*) FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2)::int AS requests,
       (SELECT count(*) FROM order_history h WHERE h.kind = 'stage' AND h.outcome = 'repaired' AND h.started_at >= $1 AND h.started_at < $2)::int AS repaired,
       (SELECT count(*) FROM order_history h WHERE h.kind = 'stage' AND h.outcome = 'declined' AND h.started_at >= $1 AND h.started_at < $2)::int AS declined,
       coalesce((SELECT sum(w.qty) FROM device_works w WHERE w.kind = 'refill' AND w.done_at >= $1 AND w.done_at < $2), 0)::int AS refills,
       (SELECT count(*) FROM device_works w WHERE w.done_at >= $1 AND w.done_at < $2)::int AS works,
       coalesce((SELECT sum(w.amount) FROM device_works w WHERE w.done_at >= $1 AND w.done_at < $2), 0)::float8 AS revenue,
       (SELECT avg(extract(epoch FROM (o.issued_at - o.created_at)) / 86400) FROM orders o WHERE o.issued_at >= $1 AND o.issued_at < $2)::float8 AS "avgDays",
       (SELECT count(*) FROM order_history h WHERE h.kind = 'reopen' AND h.started_at >= $1 AND h.started_at < $2)::int AS "warrantyReturns",
       (SELECT count(DISTINCT o.client_id) FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2)::int AS "activeClients"`,
    [from, to],
  );
  return r!;
}

const DEVICE_JOINS = `
  JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN brands b ON b.id = d.brand_id
  LEFT JOIN models m ON m.id = d.model_id`;

/**
 * Аналитика для руководителя: месяц против месяца, динамика за год, мастера, дорогая техника и клиенты.
 * Деньги берутся из сумм в журнале работ: это то, что внесли мастера.
 */
analyticsRouter.get(
  '/analytics',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const now = new Date();
    const month = String(req.query.month ?? monthKey(now));
    const { from, to } = monthRange(month);
    const compare = String(req.query.compare ?? monthKey(addMonths(from, -1)));
    const cmp = monthRange(compare);
    const span = Math.min(Math.max(Number(req.query.span) || 12, 1), 36);
    const windowFrom = addMonths(from, -(span - 1));
    if (to.getTime() - windowFrom.getTime() <= 0) throw new HttpError(400, 'Период указан неверно');

    const trendMonths = Array.from({ length: 12 }, (_, i) => addMonths(from, i - 11));
    const [current, previous, trend] = await Promise.all([
      totals(from, to),
      totals(cmp.from, cmp.to),
      Promise.all(trendMonths.map(async (m) => ({ month: monthKey(m), ...(await totals(m, addMonths(m, 1))) }))),
    ]);

    const masters = await many<AnalyticsMaster>(
      `SELECT u.id AS "userId", u.full_name AS name, u.position,
              coalesce(w.works, 0)::int AS works, coalesce(w.orders, 0)::int AS orders,
              coalesce(w.refills, 0)::int AS refills, coalesce(w.revenue, 0)::float8 AS revenue,
              coalesce(s.stages, 0)::int AS stages
         FROM users u
         LEFT JOIN (
           SELECT coalesce(w.performer_id, w.created_by) AS uid, count(*) AS works, count(DISTINCT w.order_id) AS orders,
                  sum(w.qty) FILTER (WHERE w.kind = 'refill') AS refills, sum(w.amount) AS revenue
             FROM device_works w WHERE w.done_at >= $1 AND w.done_at < $2 GROUP BY 1
         ) w ON w.uid = u.id
         LEFT JOIN (
           SELECT h.responsible_id AS uid, count(*) AS stages
             FROM order_history h WHERE h.kind = 'stage' AND h.started_at >= $1 AND h.started_at < $2 GROUP BY 1
         ) s ON s.uid = u.id
        WHERE u.role <> 'customer' AND (coalesce(w.works, 0) + coalesce(s.stages, 0)) > 0
        ORDER BY revenue DESC, works DESC, name`,
      [from, to],
    );

    const devices = await many<AnalyticsDevice>(
      `SELECT d.id AS "deviceId", ${DEVICE_TITLE} AS title, d.inventory_no AS "inventoryNo",
              c.id AS "clientId", c.name AS "clientName",
              count(w.id)::int AS works, coalesce(sum(w.amount), 0)::float8 AS revenue, max(w.done_at) AS "lastWorkAt",
              0 AS early
         FROM device_works w
         JOIN devices d ON d.id = w.device_id
         JOIN clients c ON c.id = d.client_id
         ${DEVICE_JOINS}
        WHERE w.done_at >= $1 AND w.done_at < $2
        GROUP BY d.id, dt.name, b.name, m.name, c.id
        ORDER BY revenue DESC, works DESC LIMIT 10`,
      [windowFrom, to],
    );

    // Замена детали раньше расчётного ресурса: пробег между заменами меньше ресурса прошлой детали.
    const early = await many<EarlyReplacement>(
      `WITH seq AS (
         SELECT w.id, w.device_id, w.title, w.counter, w.done_at,
                lag(w.counter) OVER p AS prev_counter, lag(w.resource) OVER p AS prev_resource
           FROM device_works w
          WHERE w.kind = 'part' AND w.counter IS NOT NULL AND w.device_id IS NOT NULL
         WINDOW p AS (PARTITION BY w.device_id, lower(trim(w.title)) ORDER BY w.done_at, w.id)
       )
       SELECT s.device_id AS "deviceId", ${DEVICE_TITLE} AS title, c.name AS "clientName", s.title AS part,
              (s.counter - s.prev_counter)::int AS passed, s.prev_resource::int AS resource, s.done_at AS "doneAt"
         FROM seq s
         JOIN devices d ON d.id = s.device_id
         JOIN clients c ON c.id = d.client_id
         ${DEVICE_JOINS}
        WHERE s.prev_counter IS NOT NULL AND s.prev_resource IS NOT NULL
          AND s.counter - s.prev_counter < s.prev_resource
          AND s.done_at >= $1 AND s.done_at < $2
        ORDER BY s.done_at DESC LIMIT 10`,
      [windowFrom, to],
    );
    for (const d of devices) d.early = early.filter((e) => e.deviceId === d.deviceId).length;

    const clients = await many<AnalyticsClient>(
      `SELECT * FROM (
         SELECT c.id AS "clientId", c.name, c.kind,
                (SELECT count(*) FROM orders o WHERE o.client_id = c.id AND o.created_at >= $1 AND o.created_at < $2)::int AS requests,
                (SELECT count(*) FROM orders o WHERE o.client_id = c.id)::int AS "allTime",
                coalesce((SELECT sum(w.amount) FROM device_works w WHERE w.client_id = c.id AND w.done_at >= $1 AND w.done_at < $2), 0)::float8 AS revenue
           FROM clients c
       ) r
       WHERE requests > 0 OR revenue > 0
       ORDER BY revenue DESC, requests DESC, name LIMIT 10`,
      [windowFrom, to],
    );
    for (const c of clients) c.regular = c.allTime >= 5;

    const data: Analytics = { month, compare, span, current, previous, trend, masters, devices, clients, early };
    res.json(data);
  }),
);
