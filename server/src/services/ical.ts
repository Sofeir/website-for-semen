/** Календарь задач в формате iCalendar (.ics) для подписки из Google Календаря, iCloud и других. */

export interface CalendarEventItem {
  id: number;
  title: string;
  note: string | null;
  startAt: Date;
  createdAt: Date;
}

export interface CalendarTask {
  id: number;
  title: string;
  description: string | null;
  dueAt: Date;
  updatedAt: Date;
  clientName: string | null;
  orderNumber: string | null;
  /** Этап заявки и техника: этап в календаре подписывается как заявка. */
  stageName?: string | null;
  deviceTitle?: string | null;
}

/** Экранирует текст поля. Любые переводы строки (и одиночный \r) становятся «\n», остальные управляющие символы убираются: иначе в ленту можно было бы вставить свои строки календаря. */
const escapeText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

/** Строки длиннее 75 байт переносятся: продолжение начинается с пробела. Режем по символам, чтобы не разорвать русскую букву. */
function fold(line: string): string {
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > 75) {
      parts.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += size;
  }
  parts.push(cur);
  return parts.join('\r\n');
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Напоминания календаря: у каждого сотрудника свой набор «за N минут». */
function alarms(minutes: number[], text: string): string[] {
  return minutes.flatMap((m) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(text)}`, `TRIGGER:-PT${m}M`, 'END:VALARM']);
}

/**
 * Одна задача — одно событие, которое заканчивается в крайний срок задачи (полчаса до срока).
 * Закрытые задачи в ленту не попадают, поэтому календарь сам убирает их при следующем обновлении.
 */
export function buildCalendar(
  tasks: CalendarTask[],
  origin: string,
  calendarName: string,
  now = new Date(),
  opts: { reminders?: number[]; events?: CalendarEventItem[] } = {},
): string {
  const reminders = opts.reminders ?? [120];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ASOFT Сервис//Задачи//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const t of tasks) {
    // eslint-disable-next-line no-control-regex
    const link = `${origin}/tasks?task=${t.id}`.replace(/[\x00-\x20\x7f]/g, '');
    const description = [t.description, t.clientName && `Клиент: ${t.clientName}`, t.orderNumber && `Заявка №${t.orderNumber}`, link]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${t.id}@servicedesk`,
      `DTSTAMP:${utc(now)}`,
      `LAST-MODIFIED:${utc(t.updatedAt)}`,
      `DTSTART:${utc(new Date(t.dueAt.getTime() - 30 * 60_000))}`,
      `DTEND:${utc(t.dueAt)}`,
      `SUMMARY:${escapeText(t.stageName && t.orderNumber ? `Заявка №${t.orderNumber}: ${t.deviceTitle ?? ''} (${t.stageName})`.replace(/\s+\(/, ' (') : `Крайний срок: ${t.title}`)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${link}`,
      ...alarms(reminders, `Скоро крайний срок: ${t.title}`),
      'END:VEVENT',
    );
  }
  for (const e of opts.events ?? []) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-${e.id}@servicedesk`,
      `DTSTAMP:${utc(now)}`,
      `LAST-MODIFIED:${utc(e.createdAt)}`,
      `DTSTART:${utc(e.startAt)}`,
      `DTEND:${utc(new Date(e.startAt.getTime() + 30 * 60_000))}`,
      `SUMMARY:${escapeText(e.title)}`,
      ...(e.note ? [`DESCRIPTION:${escapeText(e.note)}`] : []),
      ...alarms(reminders, `Скоро: ${e.title}`),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
