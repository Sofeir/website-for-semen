import type { WorkSettings } from '@sd/shared';

function hm(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number);
  return [h || 0, m || 0];
}

/** ISO-номер дня недели: 1 — понедельник, 7 — воскресенье. */
export const isoDay = (d: Date) => d.getDay() || 7;

export function isWorkDay(d: Date, ws: WorkSettings) {
  return ws.workDays.includes(isoDay(d));
}

export function endOfWorkDay(d: Date, ws: WorkSettings): Date {
  const [h, m] = hm(ws.workEnd);
  const r = new Date(d);
  r.setHours(h, m, 0, 0);
  return r;
}

/**
 * Срок по умолчанию: конец рабочего дня через `days` рабочих дней.
 * days = 0 — сегодня до конца рабочего дня (или ближайший рабочий день, если сегодня уже поздно).
 */
export function addWorkDays(from: Date, days: number, ws: WorkSettings): Date {
  let d = new Date(from);
  if (days === 0) {
    while (!isWorkDay(d, ws) || d >= endOfWorkDay(d, ws)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
    }
    return endOfWorkDay(d, ws);
  }
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkDay(d, ws)) left--;
  }
  return endOfWorkDay(d, ws);
}

export function defaultDue(ws: WorkSettings, from = new Date(), days = ws.defaultDueDays): Date {
  return addWorkDays(from, days, ws);
}

/** Рабочий день заканчивается в workEnd: срок позже этого времени переносим на конец того же дня. */
export function clampToWorkEnd(d: Date, ws: WorkSettings): Date {
  const end = endOfWorkDay(d, ws);
  return d > end ? end : d;
}

export function startOfDay(d = new Date()) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d = new Date()) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function formatDateTimeRu(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d));
}

export function formatDateRu(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}
