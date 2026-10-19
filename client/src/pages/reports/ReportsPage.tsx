import { useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Download, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MonthlyReport, ReportRow, ReportTotals } from '@sd/shared';
import { useMonthlyReport } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, IconButton } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner } from '@/ui/Display';
import { Segmented } from '@/ui/Form';
import s from './ReportsPage.module.css';

type Scope = 'all' | 'legal' | 'person';

const STATS: { key: keyof ReportTotals; label: string }[] = [
  { key: 'accepted', label: 'Принято заявок' },
  { key: 'repaired', label: 'Ремонтов' },
  { key: 'declined', label: 'Без ремонта' },
  { key: 'refills', label: 'Картриджей' },
  { key: 'parts', label: 'Замен деталей' },
  { key: 'otherWorks', label: 'Прочих работ' },
];

const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shift = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  return ym(new Date(y, m - 1 + n, 1));
};
const label = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const t = monthFmt.format(new Date(y, m - 1, 1));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function toCsv(report: MonthlyReport, scope: Scope) {
  const head = ['Клиент', 'Тип', 'Принято заявок', 'Ремонтов', 'Без ремонта', 'Картриджей', 'Замен деталей', 'Прочих работ'];
  const rows = report.rows
    .filter((r) => scope === 'all' || r.kind === scope)
    .map((r) => [r.clientName, r.kind === 'legal' ? 'Юрлицо' : 'Физлицо', r.accepted, r.repaired, r.declined, r.refills, r.parts, r.otherWorks]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
}

function StatGrid({ totals }: { totals: ReportTotals }) {
  return (
    <dl className={s.stats}>
      {STATS.map((st) => (
        <div key={st.key} className={s.stat}>
          <dt>{st.label}</dt>
          <dd>{totals[st.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Помесячный отчёт: сколько заявок принято, ремонтов сделано, картриджей заправлено.
 * «Все» — слитный отчёт по юрлицам и физлицам вместе, с разбивкой итогов.
 */
export default function ReportsPage() {
  useDocumentTitle('Отчёты');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [scope, setScope] = useState<Scope>('all');
  const q = useMonthlyReport(month);
  const report = q.data;
  const rows: ReportRow[] = (report?.rows ?? []).filter((r) => scope === 'all' || r.kind === scope);

  const download = () => {
    if (!report) return;
    const blob = new Blob([toCsv(report, scope)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `otchet-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        title="Отчёты"
        subtitle="По месяцам: заявки, ремонты, заправки картриджей. Считается само из заявок и журнала техники."
        actions={
          <Button variant="secondary" icon={<Download size={18} aria-hidden />} onClick={download} disabled={!report}>
            Скачать CSV
          </Button>
        }
      />

      <div className={s.bar}>
        <div className={s.month}>
          <IconButton label="Предыдущий месяц" onClick={() => setMonth(shift(month, -1))}>
            <ChevronLeft />
          </IconButton>
          <h2 className={s.monthTitle}>{label(month)}</h2>
          <IconButton label="Следующий месяц" onClick={() => setMonth(shift(month, 1))}>
            <ChevronRight />
          </IconButton>
        </div>
        <Segmented<Scope>
          label="Кого показывать"
          layoutId="report-scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Все вместе' },
            { value: 'legal', label: 'Юрлица' },
            { value: 'person', label: 'Физлица' },
          ]}
        />
      </div>

      {q.isError && <ErrorBox error={q.error} />}
      {!report && q.isLoading && <Spinner />}

      {report && (
        <div className="stack">
          <Card>
            <h3 className={s.h}>Итого{scope === 'all' ? ': юрлица и физлица вместе' : scope === 'legal' ? ': юрлица' : ': физлица'}</h3>
            <StatGrid totals={report.totals[scope]} />
            {scope === 'all' && (
              <div className={s.split}>
                <div>
                  <Pill tone="violet">Юрлица</Pill>
                  <StatGrid totals={report.totals.legal} />
                </div>
                <div>
                  <Pill tone="blue">Физлица</Pill>
                  <StatGrid totals={report.totals.person} />
                </div>
              </div>
            )}
          </Card>

          {rows.length ? (
            <ul className={s.rows}>
              {rows.map((r) => (
                <li key={r.clientId}>
                  <Card>
                    <div className={s.rowHead}>
                      <Link to={`/clients/${r.clientId}`} className={s.client}>
                        {r.clientName}
                        <Link2 size={14} aria-hidden />
                      </Link>
                      <Pill tone={r.kind === 'legal' ? 'violet' : 'blue'}>{r.kind === 'legal' ? 'юрлицо' : 'физлицо'}</Pill>
                      <span className={s.devices}>техники в базе: {r.devices}</span>
                    </div>
                    <StatGrid totals={r} />
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<BarChart3 />} title="За этот месяц данных нет">
              Отчёт строится из заявок и журнала техники. Если заправки не записывать, они не попадут в отчёт.
            </EmptyState>
          )}
        </div>
      )}
    </>
  );
}
