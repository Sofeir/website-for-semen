import { Router } from 'express';
import type {
  Analytics,
  AnalyticsClient,
  AnalyticsDevice,
  AnalyticsMaster,
  AnalyticsMasterDetail,
  AnalyticsMasterVisit,
  AnalyticsMasterWork,
  AnalyticsTotals,
  EarlyReplacement,
} from '@sd/shared';
import { many, one } from '../db/pool';
import { DEVICE_TITLE } from '../services/sql';
import { h, HttpError, intParam } from '../lib/http';
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
       (SELECT count(*) FROM tasks t WHERE t.is_visit AND t.status = 'done' AND t.closed_at >= $1 AND t.closed_at < $2)::int AS visits,
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

    // Окно графика не двигается за выбранным месяцем: 12 месяцев до нынешнего. Сдвигаем, только если выбран месяц за его пределами.
    let trendEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    if (from < addMonths(trendEnd, -11)) trendEnd = addMonths(from, 11);
    if (from > trendEnd) trendEnd = from;
    const trendMonths = Array.from({ length: 12 }, (_, i) => addMonths(trendEnd, i - 11));
    const [current, previous, trend] = await Promise.all([
      totals(from, to),
      totals(cmp.from, cmp.to),
      Promise.all(trendMonths.map(async (m) => ({ month: monthKey(m), ...(await totals(m, addMonths(m, 1))) }))),
    ]);

    const masters = await many<AnalyticsMaster>(
      `SELECT u.id AS "userId", u.full_name AS name, u.position,
              coalesce(w.works, 0)::int AS works, coalesce(w.orders, 0)::int AS orders,
              coalesce(w.refills, 0)::int AS refills, coalesce(w.revenue, 0)::float8 AS revenue,
              coalesce(s.stages, 0)::int AS stages, coalesce(v.visits, 0)::int AS visits
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
         LEFT JOIN (
           SELECT coalesce(t.closed_by, t.assignee_id) AS uid, count(*) AS visits
             FROM tasks t WHERE t.is_visit AND t.status = 'done' AND t.closed_at >= $1 AND t.closed_at < $2 GROUP BY 1
         ) v ON v.uid = u.id
        WHERE (u.role IN ('diagnostician', 'master', 'assistant') AND (coalesce(w.works, 0) + coalesce(s.stages, 0) + coalesce(v.visits, 0)) > 0)
           OR coalesce(w.works, 0) > 0 OR coalesce(v.visits, 0) > 0
        ORDER BY revenue DESC, works DESC, visits DESC, name`,
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

/** Что сделал инженер за месяц: список работ с суммами. */
analyticsRouter.get(
  '/analytics/master/:id',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const month = String(req.query.month ?? monthKey(new Date()));
    const { from, to } = monthRange(month);
    const user = await one<{ name: string; position: string | null }>(
      `SELECT full_name AS name, position FROM users WHERE id = $1 AND role <> 'customer'`,
      [id],
    );
    if (!user) throw new HttpError(404, 'Сотрудник не найден');
    const works = await many<AnalyticsMasterWork>(
      `SELECT w.id, w.kind, w.title, w.qty, w.amount::float8 AS amount, w.done_at AS "doneAt",
              w.order_id AS "orderId", o.number AS "orderNumber",
              CASE WHEN d.id IS NULL THEN NULL ELSE ${DEVICE_TITLE} END AS "deviceTitle", d.inventory_no AS "inventoryNo",
              c.id AS "clientId", c.name AS "clientName",
              w.part_brand AS "partBrand", w.part_spec AS "partSpec", w.warranty_months AS "warrantyMonths", w.ops
         FROM device_works w
         JOIN clients c ON c.id = w.client_id
         LEFT JOIN orders o ON o.id = w.order_id
         LEFT JOIN devices d ON d.id = w.device_id
         LEFT JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
        WHERE coalesce(w.performer_id, w.created_by) = $1 AND w.done_at >= $2 AND w.done_at < $3
        ORDER BY w.done_at DESC, w.id DESC`,
      [id, from, to],
    );
    const visits = await many<AnalyticsMasterVisit>(
      `SELECT t.id, t.title, t.closed_at AS "closedAt", c.id AS "clientId", c.name AS "clientName",
              (SELECT count(*) FROM task_checklist_items ci WHERE ci.task_id = t.id AND ci.done)::int AS "checklistDone",
              (SELECT count(*) FROM task_checklist_items ci WHERE ci.task_id = t.id)::int AS "checklistTotal",
              (SELECT count(DISTINCT x.device_id) FROM device_inspections x WHERE x.task_id = t.id)::int AS inspected
         FROM tasks t
         LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN clients c ON c.id = coalesce(t.client_id, o.client_id)
        WHERE t.is_visit AND t.status = 'done' AND coalesce(t.closed_by, t.assignee_id) = $1 AND t.closed_at >= $2 AND t.closed_at < $3
        ORDER BY t.closed_at DESC, t.id DESC`,
      [id, from, to],
    );
    const detail: AnalyticsMasterDetail = {
      userId: id,
      name: user.name,
      position: user.position,
      month,
      total: works.reduce((s, w) => s + (w.amount ?? 0), 0),
      works,
      visits,
    };
    res.json(detail);
  }),
);
