import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Truck } from 'lucide-react';
import { useServiceLog } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { BackLink } from '@/components/BackLink';
import { fmtDate } from '@/lib/dates';
import { Button, IconButton } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner } from '@/ui/Display';
import { Segmented } from '@/ui/Form';
import { label, monthShift, thisMonth } from './reportUtils';
import r from './ReportsPage.module.css';
import s from './ServiceLogPage.module.css';

type Period = 'month' | 'year';

const MODE_LABEL = { onsite: 'Выезд', remote: 'Удалённо' } as const;

/**
 * Журнал обслуживания: когда и к кому ездили и кого обслуживали удалённо.
 * Датой считается день, когда задачу закрыли. За месяц и за год, с выгрузкой в CSV для Excel.
 */
export default function ServiceLogPage() {
  useDocumentTitle('Выезды и удалённое обслуживание');
  const [period, setPeriod] = useState<Period>('month');
  const [month, setMonth] = useState(thisMonth);
  const [year, setYear] = useState(new Date().getFullYear());
  const key = period === 'month' ? `month=${month}` : `year=${year}`;
  const q = useServiceLog(key);
  const log = q.data;

  const monthName = (m: string) => label(m).replace(/\s+\d{4}$/, '');
  const months = period === 'year' ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`) : [];
  const byMonth = new Map((log?.byMonth ?? []).map((m) => [m.month, m]));

  const step = (n: number) => (period === 'month' ? setMonth(monthShift(month, n)) : setYear(year + n));

  return (
    <>
      <BackLink fallback="/reports" fallbackLabel="Все отчёты" className={s.back} />
      <PageHeader
        title="Выезды и удалённое обслуживание"
        subtitle="Когда и к кому ездили, кого обслуживали удалённо. Датой считается день, когда задачу закрыли."
      />

      <div className={r.bar}>
        <div className={r.month}>
          <IconButton label={period === 'month' ? 'Предыдущий месяц' : 'Предыдущий год'} onClick={() => step(-1)}>
            <ChevronLeft />
          </IconButton>
          <h2 className={r.monthTitle}>{period === 'month' ? label(month) : year}</h2>
          <IconButton label={period === 'month' ? 'Следующий месяц' : 'Следующий год'} onClick={() => step(1)}>
            <ChevronRight />
          </IconButton>
        </div>
        <Segmented<Period>
          label="Период"
          layoutId="service-log-period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: 'Месяц' },
            { value: 'year', label: 'Год' },
          ]}
        />
      </div>

      {q.isError && <ErrorBox error={q.error} />}
      {!log && q.isLoading && <Spinner />}

      {log && (
        <>
          <div className={s.stats}>
            <div className={s.stat}>
              <b>{log.totals.onsite}</b>
              <span>выездов</span>
            </div>
            <div className={s.stat}>
              <b>{log.totals.remote}</b>
              <span>удалённо</span>
            </div>
            <div className={s.stat}>
              <b>{log.totals.onsite + log.totals.remote}</b>
              <span>всего</span>
            </div>
          </div>

          {period === 'year' && (
            <div className={s.months}>
              {months.map((m) => {
                const v = byMonth.get(m);
                return (
                  <button
                    key={m}
                    type="button"
                    className={`${s.monthCell} ${v ? '' : s.zero}`}
                    onClick={() => {
                      setMonth(m);
                      setPeriod('month');
                    }}
                  >
                    <b>{monthName(m)}</b>
                    <span>
                      выездов {v?.onsite ?? 0}, удалённо {v?.remote ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <Card>
            {log.items.length ? (
              <ul className={s.list}>
                {log.items.map((i) => (
                  <li key={i.taskId} className={s.item}>
                    <span className={s.date}>{fmtDate(i.doneAt)}</span>
                    <span className={s.main}>
                      {i.clientId ? <Link to={`/clients/${i.clientId}`}>{i.clientName}</Link> : <b>{i.clientName ?? 'Без клиента'}</b>}
                      <span className={s.sub}>
                        {i.title}
                        {i.performers && ` · ${i.performers}`}
                      </span>
                    </span>
                    <Pill tone={i.mode === 'remote' ? 'violet' : 'amber'}>{MODE_LABEL[i.mode]}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Truck />} title="За этот период ничего не закрыто">
                Выезд или удалённое обслуживание попадает сюда, когда задачу закрывают. Ставится в разделе «Выезды».
              </EmptyState>
            )}
          </Card>
        </>
      )}
    </>
  );
}
