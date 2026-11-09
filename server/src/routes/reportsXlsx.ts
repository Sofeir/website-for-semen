import { Router, type Response } from 'express';
import ExcelJS from 'exceljs';
import { one } from '../db/pool';
import { h, HttpError, intParam } from '../lib/http';
import { requirePermission } from '../auth/session';
import { groupWorks, loadMonthWorks, sumAmount, worksText, workLine, type MonthWork } from '../services/monthWorks';
import { monthRange } from './reports';

/**
 * Отчёты в Excel в виде их таблицы «Картриджи, ремонты»: Договор (сумма), Фирма, Работы, СРВ, Согл, Уст.
 * Общий отчёт: одна строка на организацию, работы через запятую. Отчёт по организации: каждая работа отдельной строкой.
 */
export const reportsXlsxRouter = Router();

const HEAD = ['Договор', 'Фирма', 'Работы', 'СРВ', 'Согл', 'Уст'];
const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function sheetWithHead(wb: ExcelJS.Workbook, name: string) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 11 }, { width: 42 }, { width: 100 }, { width: 7 }, { width: 7 }, { width: 7 }];
  const head = ws.addRow(HEAD);
  head.font = { bold: true, size: 10 };
  head.alignment = { horizontal: 'center', vertical: 'middle' };
  head.eachCell((c) => (c.border = BORDER));
  return ws;
}

function styleBody(ws: ExcelJS.Worksheet) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.font = { size: 9 };
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).font = { bold: true, size: 10 };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    row.getCell(3).alignment = { vertical: 'top', wrapText: true };
    for (let i = 1; i <= 6; i++) row.getCell(i).border = BORDER;
  });
}

async function send(res: Response, wb: ExcelJS.Workbook, fileName: string) {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': String(buf.length),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

const monthLabel = (month: string) => `${month.slice(5, 7)}.${month.slice(0, 4)}`;
const money = (n: number) => (n ? n : null);

reportsXlsxRouter.get(
  '/reports/works.xlsx',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const month = String(req.query.month);
    const works = await loadMonthWorks(monthRange(month));
    const byClient = new Map<number, MonthWork[]>();
    for (const w of works) byClient.set(w.clientId, [...(byClient.get(w.clientId) ?? []), w]);
    const wb = new ExcelJS.Workbook();
    const ws = sheetWithHead(wb, monthLabel(month));
    for (const list of byClient.values()) ws.addRow([money(sumAmount(list)), list[0]!.clientName, worksText(list)]);
    styleBody(ws);
    await send(res, wb, `Картриджи-ремонты-${month}.xlsx`);
  }),
);

reportsXlsxRouter.get(
  '/reports/client/:id/works.xlsx',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const id = intParam(req.params.id);
    const month = String(req.query.month);
    const client = await one<{ name: string }>('SELECT name FROM clients WHERE id = $1', [id]);
    if (!client) throw new HttpError(404, 'Клиент не найден');
    const works = await loadMonthWorks(monthRange(month), id);
    const wb = new ExcelJS.Workbook();
    const ws = sheetWithHead(wb, monthLabel(month));
    // Каждая работа отдельной строкой; сумма стоит в первой колонке, как у них «Договор»
    const rows = groupWorks(works);
    rows.forEach((w, i) => ws.addRow([money(w.amount ?? 0), i === 0 ? client.name : null, workLine(w)]));
    if (rows.length) ws.addRow([money(sumAmount(works)), 'Итого', null]);
    else ws.addRow([null, client.name, 'За этот месяц работ нет']);
    styleBody(ws);
    const safe = client.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
    await send(res, wb, `${safe}-${month}.xlsx`);
  }),
);
