import type { Content } from 'pdfmake/interfaces';
import type { CompanySettings } from '@sd/shared';
import { baseDocument, COLORS, fmtDate, fmtDateTime } from './common';

export interface ReceiptData {
  company: CompanySettings;
  createdAt: Date;
  acceptedBy: string;
  client: {
    kind: 'person' | 'legal';
    name: string;
    phone: string | null;
    contactPerson: string | null;
    inn: string | null;
  };
  comment: string | null;
  devices: {
    number: string;
    title: string;
    serial: string | null;
    fault: string;
    appearance: string[];
    appearanceNote: string | null;
    kit: string[];
    kitNote: string | null;
    hasPassword: boolean;
    department: string | null;
  }[];
}

export const DEFAULT_RECEIPT_TERMS = [
  'Диагностика бесплатная. Оплачивается только выполненная работа, стоимость согласовываем с вами до начала ремонта.',
  'Сервис-центр не отвечает за данные на носителях. Сохраните важные файлы заранее.',
  'Технику выдаём по этой квитанции или по документу, удостоверяющему личность.',
  'Если технику не забрали в течение 60 дней после уведомления о готовности, начисляется плата за хранение.',
].join('\n');

/** Примечание к заказу: условия договора сервис-центра. Печатаются под «Условиями» на каждом листе. */
export const ORDER_NOTE_TERMS = [
  'Перечень работ и их стоимость, согласно Прейскуранту Исполнителя, определяется сторонами после проведения диагностики оборудования. Стоимость первичной диагностики — от 450 рублей (в случае отказа Заказчика от ремонта).',
  'Оплата услуг Исполнителя производится непосредственно сразу после подписания Акта сдачи-приёмки выполненных работ.',
  'Исполнитель предоставляет гарантию по ремонту узлов оборудования до 30 дней и на установленные комплектующие в соответствии с гарантийным талоном. При этом гарантия Исполнителя распространяется только на те узлы или комплектующие, которые подверглись ремонту или замене Исполнителем. В случае отказа от ремонта взимается сумма 2250 рублей за аппаратную диагностику.',
  'Заказчик обязан проверить работоспособность настроенного программного обеспечения или оборудования в присутствии представителя Исполнителя.',
  'Специалист производит установку программного обеспечения только с лицензионного дистрибутива, предоставленного Заказчиком.',
  'Гарантийное обслуживание производится по адресу Заказчика, указанному в Договоре, и только при наличии у Заказчика Договора или Акта сдачи-приёмки работ, подписанных обеими сторонами. Исполнитель несёт ответственность только за услуги, оказанные в соответствии с данным Договором.',
  'Ремонт и обслуживание оборудования осуществляются в соответствии с требованиями нормативных документов и согласно Федеральному закону «О защите прав потребителей».',
  'Срок исполнения — не более 45 суток.',
  'Исполнитель не несёт гарантийных обязательств в случае отсутствия или повреждения гарантийной пломбы Исполнителя, внесения каких-либо изменений в конфигурацию оборудования, в случае замены узлов, комплектующих или расходных материалов, в случае установки или настройки программного обеспечения, в случае монтажных работ, работ по администрированию без присутствия представителя Исполнителя.',
  'Требования по устранению недостатков оказанных услуг принимаются Исполнителем только в письменном виде и при условии соблюдения установленных производителем правил эксплуатации оборудования.',
  'Установленные узлы или расходные материалы возврату не подлежат.',
  'За сохранность информации Заказчика Исполнитель ответственности не несёт.',
  'Исполнитель не несёт ответственности за некомпетентность представителя Заказчика по оценке оказанных услуг.',
  'Все изменения к Договору оформляются путём принятия дополнительных соглашений, оформленных в письменном виде с подписью Заказчика и представителя Исполнителя и являющихся неотъемлемой частью данного Договора.',
  'В случае отсутствия Заказчика по согласованному с ним месту и времени получения оборудования каждая последующая доставка оплачивается в размере 390 рублей.',
];

/** На квитанции много текста — разделы поджаты, чтобы лист с подписями влез на одну страницу A4. */
const joinList = (items: string[], note: string | null) => [items.join(', '), note].filter(Boolean).join('. ') || '—';

// A4 — 595 × 842 pt. Лист делится пополам: сверху экземпляр заказчика, снизу — сервис-центра.
const MARGIN = 18;
const WIDTH = 595 - MARGIN * 2;
const HALF = (842 - MARGIN * 2) / 2;
const PAD = 12;

const label = (text: string): Content => ({ text, fontSize: 6.5, color: COLORS.muted });
const val = (text: string): Content => ({ text, fontSize: 7.5, color: COLORS.ink });

/** Компактная таблица «подпись: значение», чтобы экземпляр поместился на пол-листа. */
function grid(rows: [string, string | null | undefined][]): Content {
  const body = rows.filter(([, v]) => v).map(([k, v]) => [label(k), val(v as string)]);
  return {
    table: { widths: [70, '*'], body },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 4,
      paddingTop: () => 0.5,
      paddingBottom: () => 0.5,
    },
  };
}

function signLine(title: string, name: string): any {
  return {
    width: '*',
    stack: [
      { text: title, fontSize: 6.5, color: COLORS.muted },
      { canvas: [{ type: 'line', x1: 0, y1: 14, x2: 170, y2: 14, lineWidth: 0.6, lineColor: COLORS.ink }] },
      { text: name, fontSize: 6.5, color: COLORS.muted, margin: [0, 2, 0, 0] },
    ],
  };
}

/**
 * Квитанция-договор: на каждую единицу техники один лист A4 с двумя одинаковыми экземплярами —
 * верхний отдаём заказчику, нижний остаётся в сервисе. Между ними линия отреза.
 * В каждом экземпляре прежние «Условия», «Примечание к заказу» (15 пунктов договора), согласие, дата и подписи.
 */
export function receiptTemplate(d: ReceiptData) {
  const numbers = d.devices.map((x) => x.number).join(', ');
  const docTitle = d.devices.length > 1 ? `Квитанции о приёме № ${numbers}` : `Квитанция о приёме № ${numbers}`;
  const client = d.client;
  const company = d.company;
  const terms = company.receiptTerms?.trim() || DEFAULT_RECEIPT_TERMS;
  const customerName = client.kind === 'legal' ? client.contactPerson || client.name : client.name;
  const contacts = [company.address, company.phone, company.workHours].filter(Boolean).join(' · ');
  const requisites = [company.legalName, company.inn && `ИНН ${company.inn}`].filter(Boolean).join(', ');

  const copy = (dev: ReceiptData['devices'][number], whose: string): Content => {
    // Длинная неисправность или комментарий занимают лишние строки — тогда мельче пункты договора,
    // чтобы экземпляр всё равно поместился на пол-листа.
    const long = [dev.title, dev.fault, d.comment, joinList(dev.appearance, dev.appearanceNote), joinList(dev.kit, dev.kitNote)]
      .map((t) => Math.max(0, Math.ceil((t?.length ?? 0) / 44) - 1))
      .reduce((a, b) => a + b, 0);
    const shrink = Math.min(1, Math.max(0, long - 2) * 0.15);
    return {
      stack: [
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: company.name || 'Сервисный центр', fontSize: 10, bold: true, color: COLORS.ink },
                requisites ? { text: requisites, fontSize: 6.5, color: COLORS.muted } : '',
                contacts ? { text: contacts, fontSize: 6.5, color: COLORS.muted } : '',
              ],
            },
            { width: 'auto', text: whose, fontSize: 7, bold: true, color: COLORS.accent, alignment: 'right' },
          ],
        },
        {
          text: [
            { text: `Квитанция о приёме № ${dev.number}`, fontSize: 11, bold: true, color: COLORS.ink },
            { text: `   от ${fmtDateTime(d.createdAt)}, принял ${d.acceptedBy}`, fontSize: 7.5, color: COLORS.muted },
          ],
          margin: [0, 4, 0, 4],
        },
        {
          columns: [
            {
              width: '*',
              stack: [
                grid([
                  [client.kind === 'legal' ? 'Организация' : 'Клиент', client.name],
                  ['ИНН', client.inn],
                  ['Контактное лицо', client.contactPerson],
                  ['Телефон', client.phone],
                  ['Пароль', dev.hasPassword ? 'сообщён мастеру' : 'не сообщался'],
                ]),
              ],
            },
            {
              width: '*',
              stack: [
                grid([
                  ['Устройство', dev.title],
                  ['Серийный номер', dev.serial || 'не указан'],
                  ['Отдел', dev.department],
                  ['Неисправность', dev.fault],
                  ['Внешний вид', joinList(dev.appearance, dev.appearanceNote)],
                  ['Комплектность', joinList(dev.kit, dev.kitNote)],
                  ['Комментарий', d.comment],
                ]),
              ],
            },
          ],
          columnGap: 12,
        },
        { text: 'Условия', fontSize: 7.5, bold: true, color: COLORS.ink, margin: [0, 4, 0, 1] },
        { text: terms, fontSize: 6 - shrink * 0.8, color: COLORS.muted, lineHeight: 1.05 },
        { text: 'Примечание к заказу', fontSize: 7.5, bold: true, color: COLORS.ink, margin: [0, 3, 0, 1] },
        // pdfmake меняет переданный список, поэтому каждому экземпляру — своя копия
        {
          ol: [...ORDER_NOTE_TERMS],
          fontSize: 5.8 - shrink,
          color: COLORS.muted,
          lineHeight: 1.03,
          separator: ['', '.'],
        } as Content,
        {
          columns: [
            { text: 'С условиями договора, прейскурантом ознакомлен и согласен.', fontSize: 7.5, bold: true, color: COLORS.ink },
            { text: `Дата: ${fmtDate(d.createdAt)}`, fontSize: 7.5, color: COLORS.ink, width: 'auto' },
          ],
          margin: [0, 4, 0, 2],
        },
        {
          columns: [
            signLine('Заказчик (представитель Заказчика): технику сдал', customerName),
            signLine('Оборудование принял представитель Исполнителя', d.acceptedBy),
          ],
          columnGap: 30,
        },
      ],
    };
  };

  const content: Content[] = d.devices.map(
    (dev, i): Content => ({
      ...(i > 0 ? { pageBreak: 'before' as const } : {}),
      table: {
        widths: [WIDTH - PAD * 2],
        heights: [HALF - PAD * 2, HALF - PAD * 2],
        dontBreakRows: true,
        body: [[copy(dev, 'Экземпляр заказчика')], [copy(dev, 'Экземпляр сервис-центра')]],
      },
      layout: {
        hLineWidth: (n: number) => (n === 1 ? 0.8 : 0),
        vLineWidth: () => 0,
        hLineColor: () => COLORS.muted,
        hLineStyle: (n: number) => (n === 1 ? { dash: { length: 4, space: 3 } } : null),
        paddingLeft: () => PAD,
        paddingRight: () => PAD,
        paddingTop: (n: number) => (n === 1 ? PAD : 0),
        paddingBottom: (n: number) => (n === 0 ? PAD : 0),
      },
    }),
  );
  return baseDocument(content, { title: docTitle, margins: [MARGIN, MARGIN, MARGIN, MARGIN] });
}
