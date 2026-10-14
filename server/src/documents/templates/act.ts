import type { Content } from 'pdfmake/interfaces';
import { actTotal, pluralRu, type Act, type CompanySettings } from '@sd/shared';
import { baseDocument, COLORS, fmtDate, fmtMoney, header, infoGrid, rublesInWords, signatures } from './common';

export interface ActData {
  company: CompanySettings;
  act: Act;
  client: { kind: 'person' | 'legal'; name: string; phone: string | null; contactPerson: string | null; inn: string | null };
  serial: string | null;
  executor: string;
}

export const DEFAULT_ACT_TERMS =
  'Работы выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам не имеет. ' +
  'Гарантия распространяется только на выполненные работы и установленные детали и не действует при механических повреждениях, ' +
  'попадании жидкости и вскрытии устройства третьими лицами.';

export const DEFAULT_REPEAT_DISCOUNT = 'При повторном обращении — скидка 10% на работы.';

export function actTemplate(d: ActData) {
  const { act, client } = d;
  const total = actTotal(act.items);
  const title = `Акт выполненных работ № ${act.number}`;

  const th = (text: string, alignment: 'left' | 'right' | 'center' = 'left') => ({ text, style: 'th', alignment });
  const td = (text: string, alignment: 'left' | 'right' | 'center' = 'left') => ({ text, style: 'td', alignment });
  const body: any[][] = [
    [th('№', 'center'), th('Работа'), th('Кол-во', 'right'), th('Цена, ₽', 'right'), th('Сумма, ₽', 'right')],
  ];
  act.items.forEach((it, i) => {
    body.push([
      td(String(i + 1), 'center'),
      td(it.name),
      td(String(Number(it.qty)).replace('.', ','), 'right'),
      td(fmtMoney(Number(it.price)), 'right'),
      td(fmtMoney(Math.round(Number(it.qty) * Number(it.price) * 100) / 100), 'right'),
    ]);
  });
  body.push([
    { text: '', colSpan: 3 },
    {},
    {},
    { text: 'Итого', style: 'th', alignment: 'right' },
    { text: fmtMoney(total), style: 'td', bold: true, alignment: 'right' },
  ]);

  const warranty =
    act.warrantyMonths > 0
      ? `Гарантия на выполненные работы — ${act.warrantyMonths} ${pluralRu(act.warrantyMonths, 'месяц', 'месяца', 'месяцев')} с даты выдачи.`
      : 'Гарантия на выполненные работы не предоставляется.';

  const content: Content[] = [
    header(d.company),
    { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1.2, lineColor: COLORS.accent }] },
    { text: title, style: 'title' },
    { text: `от ${fmtDate(act.updatedAt)}, к заявке № ${act.orderNumber}`, style: 'subtitle' },
    infoGrid([
      ['Заказчик', client.name],
      ['ИНН', client.inn],
      ['Контактное лицо', client.contactPerson],
      ['Телефон', client.phone],
      ['Устройство', act.deviceTitle],
      ['Серийный номер', d.serial],
    ]),
    { text: 'Выполненные работы', style: 'section' },
    {
      table: { headerRows: 1, widths: [22, '*', 46, 70, 76], body },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => COLORS.line,
        fillColor: (row: number) => (row === 0 ? COLORS.soft : null),
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
    },
    { text: `Всего к оплате: ${rublesInWords(total)}.`, style: 'value', margin: [0, 8, 0, 0] },
    { text: warranty, style: 'value', margin: [0, 6, 0, 0] },
    act.printRepeatDiscount
      ? { text: d.company.repeatDiscountText?.trim() || DEFAULT_REPEAT_DISCOUNT, style: 'value', margin: [0, 4, 0, 0] }
      : '',
    act.note ? { text: act.note, style: 'value', margin: [0, 6, 0, 0] } : '',
    { text: d.company.actTerms?.trim() || DEFAULT_ACT_TERMS, style: 'terms', margin: [0, 12, 0, 0] },
    signatures(
      ['Исполнитель', d.executor],
      ['Заказчик: работы принял', client.kind === 'legal' ? client.contactPerson || client.name : client.name],
    ),
  ];
  return baseDocument(content, { title });
}
