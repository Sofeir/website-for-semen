/** Календарь задач в формате iCalendar (.ics) для подписки из Google Календаря, iCloud и других. */

export interface CalendarTask {
  id: number;
  title: string;
  description: string | null;
  dueAt: Date;
  updatedAt: Date;
  clientName: string | null;
  orderNumber: string | null;
}

const escapeText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

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

/**
 * Одна задача — одно событие, которое заканчивается в срок задачи (полчаса до срока).
 * Закрытые задачи в ленту не попадают, поэтому календарь сам убирает их при следующем обновлении.
 */
export function buildCalendar(tasks: CalendarTask[], origin: string, calendarName: string, now = new Date()): string {
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
    const link = `${origin}/tasks?task=${t.id}`;
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
      `SUMMARY:${escapeText(`Срок: ${t.title}`)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${link}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`Скоро срок: ${t.title}`)}`,
      'TRIGGER:-PT2H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
