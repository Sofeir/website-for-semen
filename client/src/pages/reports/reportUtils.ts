const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const thisMonth = () => ym(new Date());

export function monthShift(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return ym(new Date(y, m - 1 + n, 1));
}

export function label(month: string) {
  const [y, m] = month.split('-').map(Number);
  const t = monthFmt.format(new Date(y, m - 1, 1));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** CSV для Excel и 1С: разделитель «;», BOM, чтобы кириллица не ломалась. */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const text = '\uFEFF' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
