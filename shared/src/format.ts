/** Оставляет только цифры телефона, приводит 8XXXXXXXXXX и XXXXXXXXXX к 7XXXXXXXXXX. */
export function normalizePhone(raw: string | null | undefined): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = normalizePhone(raw);
  if (d.length !== 11) return raw;
  return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) + ' ₽';
}

export function formatOrderNumber(n: number | string): string {
  return String(n).padStart(6, '0');
}

/** Сумма строк акта в копейках, чтобы не копить ошибку плавающей точки. */
export function actTotal(items: { qty: number | string; price: number | string }[]): number {
  const kopecks = items.reduce((sum, it) => sum + Math.round(Number(it.qty) * Number(it.price) * 100), 0);
  return kopecks / 100;
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
