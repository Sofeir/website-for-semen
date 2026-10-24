import { Router } from 'express';
import { can, formatPhone, type Inspection } from '@sd/shared';
import { many, one } from '../db/pool';
import { h, HttpError, intParam } from '../lib/http';
import { getCompanySettings } from '../services/settings';
import { DEVICE_TITLE, orderAccess } from '../services/sql';
import { assertClientWorksVisible, assertDeviceVisible, assertOrderVisible } from '../services/access';
import { renderPdf } from '../documents/render';
import { receiptTemplate } from '../documents/templates/receipt';
import { actTemplate } from '../documents/templates/act';
import { inspectionTemplate, type InspectionSheetData } from '../documents/templates/inspection';
import { INSPECTION_SELECT } from './equipment';
import { monthRange } from './reports';
import { loadAct } from './acts';

export const documentsRouter = Router();

function sendPdf(res: import('express').Response, pdf: Buffer, fileName: string, download: boolean) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(pdf.length),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store',
  });
  res.end(pdf);
}

documentsRouter.get(
  '/documents/receipt/:batchId.pdf',
  h(async (req, res) => {
    const batchId = intParam(req.params.batchId);
    const batch = await one(
      `SELECT b.id, b.created_at, b.comment, u.full_name AS accepted_by,
              c.kind, c.name, c.phone, c.contact_person, c.inn
         FROM intake_batches b JOIN clients c ON c.id = b.client_id LEFT JOIN users u ON u.id = b.created_by
        WHERE b.id = $1`,
      [batchId],
    );
    if (!batch) throw new HttpError(404, 'Квитанция не найдена');
    if (!can(req.user!.role, 'orders.viewAll')) {
      const visible = await one(`SELECT 1 FROM orders o WHERE o.batch_id = $1 AND ${orderAccess('o', '$2')} LIMIT 1`, [
        batchId,
        req.user!.id,
      ]);
      if (!visible) throw new HttpError(403, 'Это ведёт другой сотрудник. Если доступ нужен, попросите руководителя.');
    }
    const orders = await many(
      `SELECT o.number, ${DEVICE_TITLE} AS title, d.serial, o.appearance, o.appearance_note, o.kit, o.kit_note,
              (o.device_password IS NOT NULL AND o.device_password <> '') AS has_password, o.department,
              coalesce(nullif(concat_ws(', ',
                (SELECT string_agg(f.name, ', ') FROM faults f WHERE f.id = ANY (o.fault_ids)), o.fault_text), ''), '—') AS fault
         FROM orders o
         JOIN devices d ON d.id = o.device_id
         JOIN device_types dt ON dt.id = d.device_type_id
         LEFT JOIN brands b ON b.id = d.brand_id
         LEFT JOIN models m ON m.id = d.model_id
        WHERE o.batch_id = $1 ORDER BY o.number`,
      [batchId],
    );
    const pdf = await renderPdf(
      receiptTemplate({
        company: await getCompanySettings(),
        createdAt: batch.created_at,
        acceptedBy: batch.accepted_by ?? '—',
        comment: batch.comment,
        client: {
          kind: batch.kind,
          name: batch.name,
          phone: formatPhone(batch.phone) || null,
          contactPerson: batch.contact_person,
          inn: batch.inn,
        },
        devices: orders.map((o) => ({
          number: o.number,
          title: o.title,
          serial: o.serial,
          fault: o.fault,
          appearance: o.appearance,
          appearanceNote: o.appearance_note,
          kit: o.kit,
          kitNote: o.kit_note,
          hasPassword: o.has_password,
          department: o.department,
        })),
      }),
    );
    sendPdf(res, pdf, `Квитанция ${orders.map((o) => o.number).join(', ')}.pdf`, req.query.download === '1');
  }),
);

documentsRouter.get(
  '/documents/act/:id.pdf',
  h(async (req, res) => {
    const act = await loadAct(intParam(req.params.id));
    if (!act) throw new HttpError(404, 'Акт не найден');
    await assertOrderVisible(req.user!, act.orderId);
    const extra = await one(
      `SELECT c.kind, c.name, c.phone, c.contact_person, c.inn, d.serial, coalesce(u.full_name, uc.full_name) AS executor
         FROM acts a JOIN orders o ON o.id = a.order_id JOIN clients c ON c.id = o.client_id
         JOIN devices d ON d.id = o.device_id
         LEFT JOIN users u ON u.id = a.updated_by LEFT JOIN users uc ON uc.id = a.created_by
        WHERE a.id = $1`,
      [act.id],
    );
    const pdf = await renderPdf(
      actTemplate({
        company: await getCompanySettings(),
        act,
        client: {
          kind: extra.kind,
          name: extra.name,
          phone: formatPhone(extra.phone) || null,
          contactPerson: extra.contact_person,
          inn: extra.inn,
        },
        serial: extra.serial,
        executor: extra.executor ?? '—',
      }),
    );
    sendPdf(res, pdf, `Акт ${act.number}.pdf`, req.query.download === '1');
  }),
);

// ---------- Проверка техники ----------

const toSheet = (i: Inspection): InspectionSheetData => ({
  kind: i.kind,
  deviceTitle: i.deviceTitle,
  inventoryNo: i.inventoryNo,
  hostName: i.hostName,
  personName: i.personName,
  personPhone: i.personPhone,
  counter: i.counter,
  note: i.note,
  items: i.items,
  performer: i.performerName,
  inspectedAt: i.inspectedAt,
});

/** Все проверки клиента за месяц одним бланком: сначала ПК, потом МФУ. */
documentsRouter.get(
  '/documents/inspections/client/:clientId.pdf',
  h(async (req, res) => {
    const clientId = intParam(req.params.clientId);
    await assertClientWorksVisible(req.user!, clientId);
    const client = await one<{ name: string }>('SELECT name FROM clients WHERE id = $1', [clientId]);
    if (!client) throw new HttpError(404, 'Клиент не найден');
    const { from, to } = monthRange(req.query.month ?? new Date().toISOString().slice(0, 7));
    // последняя проверка каждой единицы за месяц
    const list = await many<Inspection>(
      `${INSPECTION_SELECT}
        WHERE i.client_id = $1 AND i.inspected_at >= $2 AND i.inspected_at < $3
          AND i.id = (SELECT max(x.id) FROM device_inspections x WHERE x.device_id = i.device_id AND x.inspected_at >= $2 AND x.inspected_at < $3)
        ORDER BY i.kind, d.location NULLS LAST, d.inventory_no NULLS LAST, i.id`,
      [clientId, from, to],
    );
    if (!list.length) throw new HttpError(404, 'За этот месяц проверок нет');
    const pdf = await renderPdf(inspectionTemplate({ company: await getCompanySettings(), clientName: client.name, sheets: list.map(toSheet) }));
    sendPdf(res, pdf, `Проверка техники ${client.name}.pdf`, req.query.download === '1');
  }),
);

documentsRouter.get(
  '/documents/inspection/:id.pdf',
  h(async (req, res) => {
    const i = await one<Inspection>(`${INSPECTION_SELECT} WHERE i.id = $1`, [intParam(req.params.id)]);
    if (!i) throw new HttpError(404, 'Проверка не найдена');
    await assertDeviceVisible(req.user!, i.deviceId);
    const client = await one<{ name: string }>('SELECT name FROM clients WHERE id = $1', [i.clientId]);
    const pdf = await renderPdf(inspectionTemplate({ company: await getCompanySettings(), clientName: client?.name ?? null, sheets: [toSheet(i)] }));
    sendPdf(res, pdf, `Проверка ${i.deviceTitle}.pdf`, req.query.download === '1');
  }),
);

/** Пустой бланк для заполнения от руки: пункты берутся из справочника. */
documentsRouter.get(
  '/documents/inspection-blank/:kind.pdf',
  h(async (req, res) => {
    const kind = String(req.params.kind);
    if (kind !== 'pc' && kind !== 'printer') throw new HttpError(404, 'Нет такого бланка');
    const items = await many<{ name: string }>(
      `SELECT name FROM checklist_items WHERE kind = $1 AND is_active ORDER BY sort, id`,
      [kind === 'pc' ? 'inspect_pc' : 'inspect_printer'],
    );
    const sheet: InspectionSheetData = {
      kind,
      deviceTitle: null,
      inventoryNo: null,
      hostName: null,
      personName: null,
      personPhone: null,
      counter: null,
      note: null,
      items: items.map((x) => ({ title: x.name, done: false })),
      performer: null,
      inspectedAt: null,
    };
    const pdf = await renderPdf(inspectionTemplate({ company: await getCompanySettings(), clientName: null, sheets: [sheet] }));
    sendPdf(res, pdf, kind === 'pc' ? 'Бланк проверки ПК.pdf' : 'Бланк проверки МФУ.pdf', req.query.download === '1');
  }),
);
