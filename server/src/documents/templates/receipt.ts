import type { Content } from 'pdfmake/interfaces';
import type { CompanySettings } from '@sd/shared';
import { baseDocument, COLORS, fmtDate, fmtDateTime, header, infoGrid, signatures } from './common';

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

/** Примечание к заказу: условия договора с квитанции сервис-центра. Один пункт — одна строка. */
export const DEFAULT_RECEIPT_TERMS = [
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
].join('\n');

const joinList = (items: string[], note: string | null) => [items.join(', '), note].filter(Boolean).join('. ') || '—';

/** Пункты условий: из реквизитов (одна строка — один пункт) или стандартные. Старая нумерация в начале строки убирается. */
function termItems(custom: string | undefined): string[] {
  return (custom?.trim() || DEFAULT_RECEIPT_TERMS)
    .split('\n')
    .map((l) => l.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean);
}

/**
 * Квитанция: каждая единица техники — на своём листе со своим номером, условиями и подписями,
 * даже если в одном приёме их несколько (так листы можно отдать и подшить по отдельности).
 */
export function receiptTemplate(d: ReceiptData) {
  const numbers = d.devices.map((x) => x.number).join(', ');
  const docTitle = d.devices.length > 1 ? `Квитанции о приёме № ${numbers}` : `Квитанция о приёме № ${numbers}`;
  const client = d.client;
  const terms = termItems(d.company.receiptTerms);
  const customerName = client.kind === 'legal' ? client.contactPerson || client.name : client.name;

  const content: Content[] = d.devices.flatMap((dev, i): Content[] => [
    {
      stack: [header(d.company)],
      ...(i > 0 ? { pageBreak: 'before' as const } : {}),
    },
    { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1.2, lineColor: COLORS.accent }] },
    { text: `Квитанция о приёме № ${dev.number}`, style: 'title' },
    { text: `Дата приёма: ${fmtDateTime(d.createdAt)}. Принял: ${d.acceptedBy}.`, style: 'subtitle' },
    { text: client.kind === 'legal' ? 'Организация' : 'Клиент', style: 'section', margin: [0, 2, 0, 4] },
    infoGrid([
      [client.kind === 'legal' ? 'Название' : 'ФИО', client.name],
      ['ИНН', client.inn],
      ['Контактное лицо', client.contactPerson],
      ['Телефон', client.phone],
    ]),
    { text: 'Техника', style: 'section' },
    infoGrid([
      ['Устройство', dev.title],
      ['Серийный номер', dev.serial || 'не указан'],
      ['Отдел', dev.department],
      ['Неисправность со слов клиента', dev.fault],
      ['Внешний вид', joinList(dev.appearance, dev.appearanceNote)],
      ['Комплектность', joinList(dev.kit, dev.kitNote)],
      ['Пароль устройства', dev.hasPassword ? 'сообщён мастеру' : 'не сообщался'],
    ]),
    d.comment ? { text: `Комментарий: ${d.comment}`, style: 'value', margin: [0, 8, 0, 0] } : '',
    { text: 'Примечание к заказу', style: 'section' },
    { ol: [...terms], style: 'terms', fontSize: 7, lineHeight: 1.15, separator: ['', '.'] } as Content,
    {
      columns: [
        { text: 'С условиями договора, прейскурантом ознакомлен и согласен.', style: 'value', bold: true },
        { text: `Дата: ${fmtDate(d.createdAt)}`, style: 'value', width: 'auto' },
      ],
      margin: [0, 8, 0, 0],
    },
    // подписи не отрываются от условий: весь низ листа держится вместе
    {
      unbreakable: true,
      stack: [
        signatures(
          ['Заказчик (представитель Заказчика)', customerName],
          ['Оборудование принял представитель Исполнителя', d.acceptedBy],
          true,
        ),
      ],
    },
  ]);
  return baseDocument(content, { title: docTitle, margins: [36, 26, 36, 28] });
}
