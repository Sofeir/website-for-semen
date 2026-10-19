/** Общие SQL-фрагменты для списков: одинаковые поля в заявках, задачах, карточке клиента. */

export const DEVICE_TITLE = `concat_ws(' ', dt.name, coalesce(b.name, d.brand_text), coalesce(m.name, d.model_text))`;

export const ORDER_SELECT = `
  SELECT o.id, o.number,
         o.client_id AS "clientId", c.name AS "clientName", c.kind AS "clientKind", c.phone AS "clientPhone",
         ${DEVICE_TITLE} AS "deviceTitle", dt.name AS "deviceType", d.serial,
         coalesce(nullif(concat_ws(', ',
           (SELECT string_agg(f.name, ', ' ORDER BY f.sort, f.name) FROM faults f WHERE f.id = ANY (o.fault_ids)),
           o.fault_text), ''), '—') AS fault,
         o.stage_id AS "stageId", s.code AS "stageCode", s.name AS "stageName", s.sort AS "stageSort", s.color AS "stageColor",
         o.responsible_id AS "responsibleId", u.full_name AS "responsibleName",
         o.stage_started_at AS "stageStartedAt", o.stage_due_at AS "stageDueAt",
         o.created_at AS "createdAt", o.issued_at AS "issuedAt",
         (o.stage_due_at IS NOT NULL AND o.stage_due_at < now() AND NOT s.is_final) AS overdue
    FROM orders o
    JOIN clients c ON c.id = o.client_id
    JOIN devices d ON d.id = o.device_id
    JOIN device_types dt ON dt.id = d.device_type_id
    LEFT JOIN brands b ON b.id = d.brand_id
    LEFT JOIN models m ON m.id = d.model_id
    JOIN stages s ON s.id = o.stage_id
    LEFT JOIN users u ON u.id = o.responsible_id`;

export const TASK_SELECT = `
  SELECT t.id, t.title, t.description, t.status,
         t.assignee_id AS "assigneeId", ua.full_name AS "assigneeName",
         t.creator_id AS "creatorId", uc.full_name AS "creatorName",
         t.order_id AS "orderId", o.number AS "orderNumber",
         coalesce(t.client_id, o.client_id) AS "clientId", c.name AS "clientName",
         t.start_at AS "startAt", t.due_at AS "dueAt", t.deadline_at AS "deadlineAt",
         t.closed_at AS "closedAt", ucl.full_name AS "closedByName", t.close_comment AS "closeComment",
         (t.stage_id IS NOT NULL) AS "isStageTask", (uc.role = 'customer') AS "fromCustomer",
         (SELECT count(*)::int FROM task_checklist_items ci WHERE ci.task_id = t.id) AS "checklistTotal",
         (SELECT count(*)::int FROM task_checklist_items ci WHERE ci.task_id = t.id AND ci.done) AS "checklistDone",
         t.is_visit AS "isVisit",
         t.kind_id AS "kindId", tk.name AS "kindName", tk.color AS "kindColor",
         (t.status = 'open' AND t.due_at < now()) AS overdue
    FROM tasks t
    JOIN users ua ON ua.id = t.assignee_id
    JOIN users uc ON uc.id = t.creator_id
    LEFT JOIN task_kinds tk ON tk.id = t.kind_id
    LEFT JOIN users ucl ON ucl.id = t.closed_by
    LEFT JOIN orders o ON o.id = t.order_id
    LEFT JOIN clients c ON c.id = coalesce(t.client_id, o.client_id)`;

export const DEVICE_SELECT = `
  SELECT d.id, d.client_id AS "clientId", d.device_type_id AS "deviceTypeId", dt.name AS "deviceType",
         d.brand_id AS "brandId", coalesce(b.name, d.brand_text) AS brand,
         d.model_id AS "modelId", coalesce(m.name, d.model_text) AS model,
         d.serial, ${DEVICE_TITLE} AS title, d.inventory_no AS "inventoryNo", d.location
    FROM devices d
    JOIN device_types dt ON dt.id = d.device_type_id
    LEFT JOIN brands b ON b.id = d.brand_id
    LEFT JOIN models m ON m.id = d.model_id`;

export const CLIENT_FIELDS = `
  c.id, c.kind, c.name, c.phone, c.phone2, c.email, c.address, c.inn, c.kpp,
  c.contact_person AS "contactPerson", c.note, c.created_at AS "createdAt"`;

/** Экранирует % и _ для ILIKE. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/**
 * Заявка видна сотруднику, если он её ведёт или вёл раньше, или у него (от него) есть задача по ней.
 * `o` — псевдоним таблицы orders, `p` — параметр с id сотрудника.
 */
export const orderAccess = (o: string, p: string) =>
  `(${o}.responsible_id = ${p}
    OR EXISTS (SELECT 1 FROM order_history oh WHERE oh.order_id = ${o}.id AND oh.responsible_id = ${p})
    OR EXISTS (SELECT 1 FROM tasks ot WHERE ot.order_id = ${o}.id AND (ot.assignee_id = ${p} OR ot.creator_id = ${p})))`;

/** Задача видна, если сотрудник её исполнитель, постановщик или был в цепочке передачи. */
export const taskAccess = (t: string, p: string) =>
  `(${t}.assignee_id = ${p} OR ${t}.creator_id = ${p}
    OR EXISTS (SELECT 1 FROM task_steps ts WHERE ts.task_id = ${t}.id AND ts.assignee_id = ${p}))`;
