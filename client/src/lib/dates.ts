const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });

export const startOfDay = (d = new Date()) => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};
export const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const fmtTime = (d: string | Date) => timeFmt.format(new Date(d));
export const fmtDate = (d: string | Date) => fullFmt.format(new Date(d));
export const fmtDay = (d: string | Date) => dayFmt.format(new Date(d));
export const fmtWeekday = (d: string | Date) => weekday.format(new Date(d));

/** «сегодня, 20:00», «завтра, 12:00», «вчера, 18:00», «14 окт, 20:00». */
export function fmtWhen(d: string | Date | null | undefined, withTime = true): string {
  if (!d) return '—';
  const date = new Date(d);
  const today = startOfDay();
  const diff = Math.round((startOfDay(date).getTime() - today.getTime()) / 86400_000);
  const day =
    diff === 0
      ? 'сегодня'
      : diff === 1
        ? 'завтра'
        : diff === -1
          ? 'вчера'
          : dayShort.format(date).replace('.', '') + (date.getFullYear() !== today.getFullYear() ? ` ${date.getFullYear()}` : '');
  return withTime ? `${day}, ${fmtTime(date)}` : day;
}

/** Значение для <input type="datetime-local"> в местном времени. */
export function toLocalInput(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  return v ? new Date(v).toISOString() : '';
}

export interface WorkSettingsLike {
  workStart?: string;
  workEnd: string;
  workDays: number[];
  defaultDueDays: number;
}

/** Конец рабочего дня через N рабочих дней — так же, как считает сервер. */
export function defaultDueDate(ws: WorkSettingsLike | undefined, days?: number): Date {
  const end = ws?.workEnd ?? '19:00';
  const workDays = ws?.workDays ?? [1, 2, 3, 4, 5];
  const n = days ?? ws?.defaultDueDays ?? 1;
  const [h, m] = end.split(':').map(Number);
  const isWork = (d: Date) => workDays.includes(d.getDay() || 7);
  const atEnd = (d: Date) => {
    const r = new Date(d);
    r.setHours(h, m, 0, 0);
    return r;
  };
  let d = new Date();
  if (n === 0) {
    while (!isWork(d) || d >= atEnd(d)) d = startOfDay(addDays(d, 1));
    return atEnd(d);
  }
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWork(d)) left--;
  }
  return atEnd(d);
}

/**
 * Три быстрых срока, которые всегда разные: ближайший рабочий конец дня и два следующих рабочих дня.
 * В выходной и после конца рабочего дня «сегодня» и «завтра» упираются в один и тот же рабочий день,
 * поэтому подписи берутся по календарю: Сегодня, Завтра, Послезавтра, дальше день недели и дата.
 */
export function quickDueDates(ws: WorkSettingsLike | undefined): { label: string; date: Date }[] {
  const list: Date[] = [defaultDueDate(ws, 0)];
  for (let k = 1; list.length < 3 && k < 15; k++) {
    const d = defaultDueDate(ws, k);
    if (d.getTime() > list[list.length - 1].getTime()) list.push(d);
  }
  const today = startOfDay();
  return list.map((date) => {
    const diff = Math.round((startOfDay(date).getTime() - today.getTime()) / 86400_000);
    if (diff === 0) return { label: 'Сегодня', date };
    if (diff === 1) return { label: 'Завтра', date };
    if (diff === 2) return { label: 'Послезавтра', date };
    const day = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date);
    return { label: day.charAt(0).toUpperCase() + day.slice(1), date };
  });
}

export function isOverdue(d: string | null | undefined) {
  return Boolean(d && new Date(d).getTime() < Date.now());
}

/**
 * Начало работы над задачей со сроком `due`: если срок сегодня — с текущего момента,
 * если позже — с начала рабочего дня того дня, на который поставлен срок.
 */
export function startForDue(ws: WorkSettingsLike | undefined, due: Date): Date {
  const [h, m] = (ws?.workStart ?? '10:00').split(':').map(Number);
  const start = new Date(due);
  start.setHours(h, m, 0, 0);
  const now = new Date();
  if (sameDay(due, now)) return now > start ? now : start;
  return start;
}
