import type { Content, StyleDictionary, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { CompanySettings } from '@sd/shared';

/**
 * Общий вид документов. Шаблоны лежат отдельно от маршрутов:
 * верстку квитанции и акта правим здесь, тексты условий и реквизиты — в «Настройках».
 */
export const COLORS = {
  ink: '#0B2A4A',
  muted: '#4F6782',
  line: '#C9D6E4',
  soft: '#EEF3F9',
  accent: '#1F6B5E',
};

export const styles: StyleDictionary = {
  company: { fontSize: 13, bold: true, color: COLORS.ink },
  small: { fontSize: 8, color: COLORS.muted },
  title: { fontSize: 15, bold: true, color: COLORS.ink, margin: [0, 14, 0, 2] },
  subtitle: { fontSize: 9, color: COLORS.muted, margin: [0, 0, 0, 10] },
  label: { fontSize: 8, color: COLORS.muted },
  value: { fontSize: 10, color: COLORS.ink },
  section: { fontSize: 10, bold: true, color: COLORS.ink, margin: [0, 12, 0, 4] },
  terms: { fontSize: 7.5, color: COLORS.muted, lineHeight: 1.25 },
  th: { fontSize: 8, bold: true, color: COLORS.muted },
  td: { fontSize: 9.5, color: COLORS.ink },
};

export function header(company: CompanySettings): Content {
  const req = [
    company.legalName,
    company.inn && `ИНН ${company.inn}${company.kpp ? ` / КПП ${company.kpp}` : ''}`,
    company.ogrn && `ОГРН ${company.ogrn}`,
  ]
    .filter(Boolean)
    .join(', ');
  const contacts = [company.address, company.phone, company.email, company.site].filter(Boolean).join('  ·  ');
  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: company.name || 'Сервисный центр', style: 'company' },
          req ? { text: req, style: 'small', margin: [0, 2, 0, 0] } : '',
          contacts ? { text: contacts, style: 'small', margin: [0, 1, 0, 0] } : '',
          company.workHours ? { text: `Режим работы: ${company.workHours}`, style: 'small', margin: [0, 1, 0, 0] } : '',
        ],
      },
    ],
  };
}

/** Таблица «подпись: значение» в две колонки. `dense` — плотнее строки, когда на листе много текста. */
export function infoGrid(rows: [string, string | null | undefined][], dense = false): Content {
  const pad = dense ? 1.5 : 3;
  const body: any[][] = rows
    .filter(([, v]) => v)
    .map(([k, v]) => [
      { text: k, style: 'label', margin: [0, pad, 8, pad] },
      { text: v as string, style: 'value', margin: [0, pad - 1, 0, pad - 1] },
    ]);
  if (!body.length) return '';
  return {
    table: { widths: [110, '*'], body },
    layout: {
      hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => COLORS.line,
      paddingLeft: () => 0,
      paddingRight: () => 0,
    },
  };
}

export function signatures(left: [string, string], right: [string, string], compact = false): Content {
  const block = ([title, name]: [string, string]): any => ({
    width: '*',
    stack: [
      { text: title, style: 'label' },
      {
        canvas: [
          { type: 'line', x1: 0, y1: compact ? 18 : 26, x2: 200, y2: compact ? 18 : 26, lineWidth: 0.6, lineColor: COLORS.ink },
        ],
      },
      { text: name, style: 'small', margin: [0, 3, 0, 0] },
    ],
  });
  return { columns: [block(left), block(right)], columnGap: 40, margin: [0, compact ? 10 : 22, 0, 0] };
}

export function baseDocument(
  content: Content[],
  meta: { title: string; margins?: [number, number, number, number] },
): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: meta.margins ?? [40, 36, 40, 40],
    info: { title: meta.title, creator: 'ASOFT Сервис' },
    defaultStyle: { font: 'Roboto', fontSize: 10, color: COLORS.ink },
    styles,
    content,
    footer: (page: number, count: number) =>
      count > 1 ? { text: `${page} / ${count}`, alignment: 'right', style: 'small', margin: [0, 10, 40, 0] } : '',
  };
}

export const fmtDate = (d: Date | string) =>
  new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
export const fmtDateTime = (d: Date | string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d));
export const fmtMoney = (n: number) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// ---------- Сумма прописью ----------

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function triad(n: number, feminine: boolean) {
  const words: string[] = [];
  words.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else {
    words.push(TENS[Math.floor(rest / 10)]);
    words.push((feminine ? ONES_F : ONES_M)[rest % 10]);
  }
  return words.filter(Boolean).join(' ');
}

export function rublesInWords(amount: number): string {
  const rub = Math.floor(amount);
  const kop = Math.round((amount - rub) * 100);
  if (rub === 0) return `ноль рублей ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`;
  const groups: [number, boolean, [string, string, string] | null][] = [
    [Math.floor(rub / 1e9) % 1000, false, ['миллиард', 'миллиарда', 'миллиардов']],
    [Math.floor(rub / 1e6) % 1000, false, ['миллион', 'миллиона', 'миллионов']],
    [Math.floor(rub / 1e3) % 1000, true, ['тысяча', 'тысячи', 'тысяч']],
    [rub % 1000, false, null],
  ];
  const words: string[] = [];
  for (const [n, fem, forms] of groups) {
    if (!n) continue;
    words.push(triad(n, fem));
    if (forms) words.push(plural(n, forms));
  }
  const text = words.join(' ');
  return `${text[0].toUpperCase()}${text.slice(1)} ${plural(rub, ['рубль', 'рубля', 'рублей'])} ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`;
}
