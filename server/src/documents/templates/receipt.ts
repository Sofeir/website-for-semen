import type { Content } from 'pdfmake/interfaces';
import type { CompanySettings } from '@sd/shared';
import { baseDocument, COLORS, fmtDateTime, header, infoGrid, signatures } from './common';

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

const joinList = (items: string[], note: string | null) => [items.join(', '), note].filter(Boolean).join('. ') || '—';

export function receiptTemplate(d: ReceiptData) {
  const numbers = d.devices.map((x) => x.number).join(', ');
  const title = d.devices.length > 1 ? `Квитанция о приёме по заявкам № ${numbers}` : `Квитанция о приёме № ${numbers}`;

  const deviceBlocks: Content[] = d.devices.map((dev, i) => ({
    unbreakable: true,
    stack: [
      {
        text: d.devices.length > 1 ? `${i + 1}. Заявка № ${dev.number}` : 'Техника',
        style: 'section',
      },
      infoGrid([
        ['Устройство', dev.title],
        ['Серийный номер', dev.serial || 'не указан'],
        ['Отдел', dev.department],
        ['Неисправность со слов клиента', dev.fault],
        ['Внешний вид', joinList(dev.appearance, dev.appearanceNote)],
        ['Комплектность', joinList(dev.kit, dev.kitNote)],
        ['Пароль устройства', dev.hasPassword ? 'сообщён мастеру' : 'не сообщался'],
      ]),
    ],
  }));

  const client = d.client;
  const content: Content[] = [
    header(d.company),
    { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1.2, lineColor: COLORS.accent }] },
    { text: title, style: 'title' },
    { text: `Дата приёма: ${fmtDateTime(d.createdAt)}. Принял: ${d.acceptedBy}.`, style: 'subtitle' },
    { text: client.kind === 'legal' ? 'Организация' : 'Клиент', style: 'section', margin: [0, 2, 0, 4] },
    infoGrid([
      [client.kind === 'legal' ? 'Название' : 'ФИО', client.name],
      ['ИНН', client.inn],
      ['Контактное лицо', client.contactPerson],
      ['Телефон', client.phone],
    ]),
    ...deviceBlocks,
    d.comment ? { text: `Комментарий: ${d.comment}`, style: 'value', margin: [0, 10, 0, 0] } : '',
    { text: 'Условия', style: 'section' },
    { text: d.company.receiptTerms?.trim() || DEFAULT_RECEIPT_TERMS, style: 'terms' },
    signatures(
      ['Технику сдал, с условиями согласен', client.kind === 'legal' ? client.contactPerson || client.name : client.name],
      ['Технику принял', d.acceptedBy],
    ),
  ];
  return baseDocument(content, { title });
}
