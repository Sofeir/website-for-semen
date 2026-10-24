import type { Content } from 'pdfmake/interfaces';
import { formatPhone, type CompanySettings, type InspectionKind } from '@sd/shared';
import { baseDocument, COLORS, fmtDate, header } from './common';

/** Одна заполненная (или пустая) анкета на одну единицу техники. */
export interface InspectionSheetData {
  kind: InspectionKind;
  deviceTitle: string | null;
  inventoryNo: string | null;
  hostName: string | null;
  personName: string | null;
  personPhone: string | null;
  counter: number | null;
  note: string | null;
  items: { title: string; done: boolean }[];
  performer: string | null;
  inspectedAt: string | null;
}

export interface InspectionDocData {
  company: CompanySettings;
  clientName: string | null;
  sheets: InspectionSheetData[];
}

const TITLES: Record<InspectionKind, string> = {
  pc: 'Чек-лист проверки ПК',
  printer: 'Чек-лист проверки МФУ / принтеров',
};

const NO_BORDER: [boolean, boolean, boolean, boolean] = [false, false, false, false];

/** Строка «подпись ______»: значение пишется над линией, пустое поле остаётся линией для ручного заполнения. */
function line(label: string, value: string | null | undefined): any {
  return {
    table: {
      widths: ['auto', '*'],
      body: [
        [
          { text: label, style: 'label', border: NO_BORDER, margin: [0, 4, 6, 0] },
          { text: value || ' ', style: 'value', border: [false, false, false, true] },
        ],
      ],
    },
    layout: { hLineColor: () => COLORS.ink, hLineWidth: () => 0.5, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0 },
    margin: [0, 2, 0, 0],
  };
}

/** Квадратик для отметки: пустой или с галочкой. */
function box(done: boolean): any {
  const canvas: any[] = [{ type: 'rect', x: 0, y: 1, w: 10, h: 10, lineWidth: 0.8, lineColor: COLORS.ink }];
  if (done) {
    canvas.push({ type: 'polyline', lineWidth: 1.6, lineColor: COLORS.accent, points: [{ x: 2, y: 6.5 }, { x: 4.5, y: 9 }, { x: 8.5, y: 3 }] });
  }
  return { canvas, width: 14 };
}

function sheet(s: InspectionSheetData, i: number): Content {
  const printer = s.kind === 'printer';
  const rows: Content[] = [
    printer
      ? { columns: [line('МФУ / принтер №', s.inventoryNo), line('Тип и модель:', s.deviceTitle)], columnGap: 14 }
      : { columns: [line('ПК №', s.inventoryNo), line('Имя ПК:', s.hostName)], columnGap: 14 },
  ];
  if (!printer) {
    rows.push({
      columns: [line('ФИО сотрудника:', s.personName), { ...line('Телефон:', s.personPhone ? formatPhone(s.personPhone) || s.personPhone : null), width: 150 }],
      columnGap: 14,
    });
  } else if (s.personName || s.personPhone) {
    rows.push({ columns: [line('Ответственный:', s.personName), { ...line('Телефон:', s.personPhone ? formatPhone(s.personPhone) || s.personPhone : null), width: 150 }], columnGap: 14 });
  }
  const checks: Content = {
    margin: [0, 8, 0, 0],
    stack: s.items.map((it) => ({ columns: [box(it.done), { text: it.title, style: 'value', margin: [4, 0, 0, 0] }], margin: [0, 2.5, 0, 2.5] })),
  };
  const extra: Content[] = [];
  if (printer) extra.push({ ...line('Пробег, стр.:', s.counter == null ? null : String(s.counter)), margin: [0, 8, 0, 0] });
  extra.push(line('Примечание:', s.note));
  if (s.performer || s.inspectedAt) {
    extra.push({
      text: [s.performer && `Проверил: ${s.performer}`, s.inspectedAt && fmtDate(s.inspectedAt)].filter(Boolean).join(', '),
      style: 'small',
      margin: [0, 4, 0, 0],
    });
  }
  return {
    unbreakable: true,
    margin: [0, i === 0 ? 0 : 16, 0, 0],
    stack: [...rows, checks, ...extra],
  };
}

/** Бланк проверки: ПК и МФУ идут отдельными разделами, как на бумажных чек-листах. */
export function inspectionTemplate(d: InspectionDocData) {
  const content: Content[] = [header(d.company), { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1.2, lineColor: COLORS.accent }] }];
  let first = true;
  for (const kind of ['pc', 'printer'] as const) {
    const list = d.sheets.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const performers = [...new Set(list.map((s) => s.performer).filter(Boolean))].join(', ');
    const dates = list.map((s) => s.inspectedAt).filter(Boolean) as string[];
    const from = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
    const to = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    const when = from && to ? (fmtDate(from) === fmtDate(to) ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`) : null;
    content.push(
      { text: TITLES[kind], style: 'title', pageBreak: first ? undefined : 'before' },
      line('Организация:', d.clientName),
      line('Исполнитель:', performers || null),
      line('Дата проверки:', when),
      { text: '', margin: [0, 8, 0, 0] },
      ...list.map((s, i) => sheet(s, i)),
    );
    first = false;
  }
  return baseDocument(content, { title: 'Проверка техники' });
}
