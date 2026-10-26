import { Router } from 'express';
import type { ClientReport, ClientReportOrder, ClientReportVisit, ClientReportWork, MonthlyReport, ReportRow, ReportTotals } from '@sd/shared';
import { many, one } from '../db/pool';
import { DEVICE_TITLE } from '../services/sql';
import { h, HttpError, intParam } from '../lib/http';
import { requirePermission } from '../auth/session';

export const reportsRouter = Router();

const FIELDS = ['accepted', 'repaired', 'declined', 'refills', 'parts', 'otherWorks', 'visits'] as const;
const emptyTotals = (): ReportTotals => ({ accepted: 0, repaired: 0, declined: 0, refills: 0, parts: 0, otherWorks: 0, visits: 0 });

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
           (SELECT count(*) FROM tasks t LEFT JOIN orders o ON o.id = t.order_id
             WHERE t.is_visit AND t.status = 'done' AND coalesce(t.client_id, o.client_id) = c.id AND t.closed_at >= $1 AND t.closed_at < $2)::int AS visits,
           (SELECT count(*) FROM devices d WHERE d.client_id = c.id)::int AS devices
           FROM clients c
       ) r
       WHERE accepted + repaired + declined + refills + parts + "otherWorks" + visits > 0
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

/**
 * Подробности по одному клиенту за месяц. Итоги те же, что в строке отчёта: заявки, ремонты, без ремонта, картриджи.
 * Каждая запись ведёт на свою заявку: заявки со своими работами, заправки с номером заявки и прочие работы.
 */
reportsRouter.get(
  '/reports/client/:id',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const month = String(req.query.month);
    const { from, to } = monthRange(month);
    const client = await one<{ name: string; kind: 'person' | 'legal' }>('SELECT name, kind FROM clients WHERE id = $1', [id]);
    if (!client) throw new HttpError(404, 'Клиент не найден');

    const totals = (await one<ClientReport['totals']>(
      `SELECT
         (SELECT count(*) FROM orders o WHERE o.client_id = $1 AND o.created_at >= $2 AND o.created_at < $3)::int AS accepted,
         (SELECT count(*) FROM order_history h JOIN orders o ON o.id = h.order_id
           WHERE o.client_id = $1 AND h.kind = 'stage' AND h.outcome = 'repaired' AND h.started_at >= $2 AND h.started_at < $3)::int AS repaired,
         (SELECT count(*) FROM order_history h JOIN orders o ON o.id = h.order_id
           WHERE o.client_id = $1 AND h.kind = 'stage' AND h.outcome = 'declined' AND h.started_at >= $2 AND h.started_at < $3)::int AS declined,
         coalesce((SELECT sum(w.qty) FROM device_works w WHERE w.client_id = $1 AND w.kind = 'refill' AND w.done_at >= $2 AND w.done_at < $3), 0)::int AS refills,
         (SELECT count(*) FROM tasks t LEFT JOIN orders o ON o.id = t.order_id
             WHERE t.is_visit AND t.status = 'done' AND coalesce(t.client_id, o.client_id) = $1 AND t.closed_at >= $2 AND t.closed_at < $3)::int AS visits`,
      [id, from, to],
    ))!;

    const visits = await many<ClientReportVisit>(
      `SELECT t.id, t.title, t.closed_at AS "closedAt", coalesce(uc.full_name, ua.full_name) AS "performerName",
              (SELECT count(*) FROM task_checklist_items ci WHERE ci.task_id = t.id AND ci.done)::int AS "checklistDone",
              (SELECT count(*) FROM task_checklist_items ci WHERE ci.task_id = t.id)::int AS "checklistTotal",
              (SELECT count(DISTINCT x.device_id) FROM device_inspections x WHERE x.task_id = t.id)::int AS inspected,
              t.close_comment AS "closeComment"
         FROM tasks t
         LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN users ua ON ua.id = t.assignee_id
         LEFT JOIN users uc ON uc.id = t.closed_by
        WHERE t.is_visit AND t.status = 'done' AND coalesce(t.client_id, o.client_id) = $1 AND t.closed_at >= $2 AND t.closed_at < $3
        ORDER BY t.closed_at, t.id`,
      [id, from, to],
    );

    const orders = await many<Omit<ClientReportOrder, 'works'>>(
      `SELECT o.id, o.number, ${DEVICE_TITLE} AS "deviceTitle", s.name AS "stageName", o.created_at AS "createdAt",
              (o.created_at >= $2 AND o.created_at < $3) AS "acceptedInMonth",
              (SELECT h.outcome FROM order_history h WHERE h.order_id = o.id AND h.kind = 'stage' AND h.outcome IS NOT NULL
                  AND h.started_at >= $2 AND h.started_at < $3 ORDER BY h.started_at DESC, h.id DESC LIMIT 1) AS outcome,
              (SELECT h.started_at FROM order_history h WHERE h.order_id = o.id AND h.kind = 'stage' AND h.outcome IS NOT NULL
                  AND h.started_at >= $2 AND h.started_at < $3 ORDER BY h.started_at DESC, h.id DESC LIMIT 1) AS "outcomeAt"
         FROM orders o
         JOIN stages s ON s.id = o.stage_id
         JOIN devices d ON d.id = o.device_id
         JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
        WHERE o.client_id = $1
          AND ((o.created_at >= $2 AND o.created_at < $3)
               OR EXISTS (SELECT 1 FROM order_history h WHERE h.order_id = o.id AND h.kind = 'stage' AND h.outcome IS NOT NULL
                            AND h.started_at >= $2 AND h.started_at < $3))
        ORDER BY o.created_at, o.id`,
      [id, from, to],
    );

    const works = await many<ClientReportWork>(
      `SELECT w.id, w.kind, w.title, w.qty, w.counter, w.amount::float8 AS amount, w.done_at AS "doneAt", w.ops,
              w.order_id AS "orderId", o.number AS "orderNumber",
              CASE WHEN d.id IS NULL THEN NULL ELSE concat_ws(' ', nullif(d.inventory_no, ''), ${DEVICE_TITLE}) END AS "deviceTitle"
         FROM device_works w
         LEFT JOIN orders o ON o.id = w.order_id
         LEFT JOIN devices d ON d.id = w.device_id
         LEFT JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
        WHERE w.client_id = $1 AND w.done_at >= $2 AND w.done_at < $3
        ORDER BY w.done_at, w.id`,
      [id, from, to],
    );

    const byOrder = new Map<number, ClientReportWork[]>();
    const other: ClientReportWork[] = [];
    const orderIds = new Set(orders.map((o) => o.id));
    for (const w of works) {
      if (w.kind === 'refill') continue;
      if (w.orderId && orderIds.has(w.orderId)) byOrder.set(w.orderId, [...(byOrder.get(w.orderId) ?? []), w]);
      else other.push(w);
    }
    const report: ClientReport = {
      clientId: id,
      clientName: client.name,
      kind: client.kind,
      month,
      totals,
      visits,
      orders: orders.map((o) => ({ ...o, works: byOrder.get(o.id) ?? [] })),
      refills: works.filter((w) => w.kind === 'refill'),
      otherWorks: other,
    };
    res.json(report);
  }),
);
