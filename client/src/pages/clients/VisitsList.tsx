import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import type { ServicePlan } from '@sd/shared';
import { periodLabel } from '@/components/ServicePlanCard';
import { fmtDay } from '@/lib/dates';
import { Card, EmptyState, ErrorBox, Spinner } from '@/ui/Display';
import s from './VisitsList.module.css';

const toDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Все графики регулярных выездов: к кому, когда следующий раз и кто едет. */
export function VisitsList({ plans, error }: { plans: ServicePlan[] | undefined; error: unknown }) {
  if (error) return <ErrorBox error={error} />;
  if (!plans) return <Spinner />;
  if (!plans.length) {
    return (
      <Card>
        <EmptyState icon={<CalendarClock />} title="Регулярных выездов пока нет">
          Откройте клиента, вкладка «Выезд», и задайте, как часто к нему ездить. Задачи будут ставиться сами.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card>
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
              </span>
              <ChevronRight aria-hidden className={s.chev} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
