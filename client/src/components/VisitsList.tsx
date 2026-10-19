import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import type { ServicePlan } from '@sd/shared';
import { periodLabel } from '@/components/ServicePlanCard';
import { fmtDay } from '@/lib/dates';
import { EmptyState } from '@/ui/Display';
import s from './VisitsList.module.css';

const toDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Графики регулярных выездов: к кому, когда ближайшие разы и кто едет. */
export function VisitsList({ plans }: { plans: ServicePlan[] }) {
  if (!plans.length) {
    return (
      <EmptyState icon={<CalendarClock />} title="Регулярных выездов пока нет">
        Нажмите «Добавить график» или откройте клиента, вкладка «Выезд». Задачи будут ставиться сами накануне.
      </EmptyState>
    );
  }
  return (
    <ul className={s.list}>
      {plans.map((p) => (
        <li key={p.id}>
          <Link to={`/clients/${p.clientId}?tab=service`} className={s.row}>
            <span className={s.date}>
              <b>{fmtDay(toDate(p.nextDate))}</b>
              {p.visitTime && <span>{p.visitTime}</span>}
            </span>
            <span className={s.main}>
              <b>{p.clientName}</b>
              <span>
                {periodLabel(p.everyN, p.unit)} · едет {p.assigneeName}
              </span>
              {p.upcoming && p.upcoming.length > 1 && (
                <span>
                  дальше:{' '}
                  {p.upcoming
                    .slice(1)
                    .map((d) => fmtDay(toDate(d)))
                    .join(', ')}
                </span>
              )}
            </span>
            <ChevronRight aria-hidden className={s.chev} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
