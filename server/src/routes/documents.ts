import { Router } from 'express';
import { can, formatPhone } from '@sd/shared';
import { many, one } from '../db/pool';
import { h, HttpError, intParam } from '../lib/http';
import { getCompanySettings } from '../services/settings';
import { DEVICE_TITLE, orderAccess } from '../services/sql';
import { assertOrderVisible } from '../services/access';
import { renderPdf } from '../documents/render';
import { receiptTemplate } from '../documents/templates/receipt';
import { actTemplate } from '../documents/templates/act';
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
