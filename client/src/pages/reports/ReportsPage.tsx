import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { MonthlyReport, ReportRow, ReportTotals } from '@sd/shared';
import { useMonthlyReport } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, IconButton, cx } from '@/ui/Button';
import { EmptyState, ErrorBox, PageHeader, Plate, Spinner } from '@/ui/Display';
import { Segmented } from '@/ui/Form';
import { ClientReportSheet } from './ClientReportSheet';
import { downloadCsv, label, monthShift, thisMonth } from './reportUtils';
import s from './ReportsPage.module.css';

type Scope = 'all' | 'legal' | 'person';
type SortKey = 'name' | 'accepted' | 'refills' | 'declined';

const SORT_LABEL: Record<SortKey, string> = {
  name: 'по имени',
  accepted: 'по числу заявок',
  refills: 'по числу картриджей',
  declined: 'по числу «без ремонта»',
};

const initials = (name: string) =>
  name
    .replace(/[«»"]/g, '')
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w) && !/^(ооо|ип|ао|зао|пао)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

/** Доля юрлиц в числе: две цветные части одной полосы. */
function Split({ legal, person }: { legal: number; person: number }) {
  const sum = legal + person;
  return (
    <span className={s.split} aria-hidden>
      {sum > 0 && <i className={s.splitLegal} style={{ flexGrow: legal }} />}
      {sum > 0 && <i className={s.splitPerson} style={{ flexGrow: person }} />}
      {sum === 0 && <i className={s.splitNone} />}
    </span>
  );
}

function HeroStat({ title, field, totals, legal, person, note }: { title: string; field: keyof ReportTotals; totals: ReportTotals; legal: ReportTotals; person: ReportTotals; note?: string }) {
  return (
    <div className={s.heroStat}>
      <span className={s.heroLabel}>{title}</span>
      <b className={s.heroNum}>{totals[field]}</b>
      <Split legal={legal[field]} person={person[field]} />
      <span className={s.heroNote}>{note ?? `юр ${legal[field]} · физ ${person[field]}`}</span>
    </div>
  );
}

function Metric({ value, name, title, active }: { value: number; name: string; title?: string; active?: boolean }) {
  return (
    <span className={cx(s.metric, !value && s.metricZero, active && s.metricActive)} title={title}>
      <b>{value}</b>
      <span>{name}</span>
    </span>
  );
}

/**
 * Помесячный отчёт: наверху главные цифры с долей юрлиц и физлиц, ниже клиенты стеклянными плашками.
 * У каждого клиента три главные цифры и полоса картриджей относительно самого «заправляемого»; редкие показатели появляются
 * только когда они не нулевые. Нажатие на клиента открывает подробности для счёта.
 */
export default function ReportsPage() {
  useDocumentTitle('Отчёты');
  const [month, setMonth] = useState(thisMonth);
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useMonthlyReport(month);
  const report = q.data;

  const groups = useMemo(() => {
    if (!report) return [];
    // По цифре: больше сверху, при равенстве смотрим остальные цифры, затем имя.
    const order = (a: ReportRow, b: ReportRow) =>
      sort === 'name'
        ? a.clientName.localeCompare(b.clientName, 'ru')
        : b[sort] - a[sort] ||
          b.accepted - a.accepted ||
          b.refills - a.refills ||
          b.repaired - a.repaired ||
          a.clientName.localeCompare(b.clientName, 'ru');
    // Сортировка по цифре идёт одним общим списком: так видно, кто на первом месте, а не только внутри группы.
    if (sort !== 'name' && scope === 'all') {
      return [
        {
          id: 'all' as const,
          title: `Все клиенты ${SORT_LABEL[sort]}`,
          totals: report.totals.all,
          rows: [...report.rows].sort(order),
        },
      ];
    }
    return (['legal', 'person'] as const)
      .filter((k) => scope === 'all' || scope === k)
      .map((k) => ({
        id: k,
        title: k === 'legal' ? 'Юрлица' : 'Физлица',
        totals: report.totals[k],
        rows: report.rows.filter((r) => r.kind === k).sort(order),
      }))
      .filter((g) => g.rows.length);
  }, [report, scope, sort]);


  return (
    <>
      <PageHeader
        title="Отчёты"
        subtitle="По месяцам: заявки, ремонты, заправки картриджей, выезды. Нажмите на клиента, чтобы увидеть, что именно сделали."
        actions={
          <Button
            variant="secondary"
            icon={<Download size={18} aria-hidden />}
            onClick={() => report && downloadCsv(`otchet-${month}.csv`, reportCsv(report, scope))}
            disabled={!report}
          >
            Скачать CSV
          </Button>
        }
      />

      <div className={s.bar}>
        <div className={s.month}>
          <IconButton label="Предыдущий месяц" onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft />
          </IconButton>
          <h2 className={s.monthTitle}>{label(month)}</h2>
          <IconButton label="Следующий месяц" onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight />
          </IconButton>
        </div>
        <Segmented<Scope>
          label="Кого показывать"
          layoutId="report-scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'legal', label: 'Юрлица' },
            { value: 'person', label: 'Физлица' },
          ]}
        />
      </div>

      {q.isError && <ErrorBox error={q.error} />}
      {!report && q.isLoading && <Spinner />}

      {report && (
        <>
          <Plate className={s.hero}>
            <HeroStat title="Заявки" field="accepted" totals={report.totals[scope]} legal={report.totals.legal} person={report.totals.person} />
            <HeroStat
              title="Ремонтов"
              field="repaired"
              totals={report.totals[scope]}
              legal={report.totals.legal}
              person={report.totals.person}
              note={report.totals[scope].declined ? `без ремонта: ${report.totals[scope].declined}` : undefined}
            />
            <HeroStat
              title="Картриджей"
              field="refills"
              totals={report.totals[scope]}
              legal={report.totals.legal}
              person={report.totals.person}
            />
            <HeroStat
              title="Выездов"
              field="visits"
              totals={report.totals[scope]}
              legal={report.totals.legal}
              person={report.totals.person}
            />
            <div className={s.legend} aria-hidden>
              <span><i className={s.splitLegal} /> юрлица</span>
              <span><i className={s.splitPerson} /> физлица</span>
            </div>
          </Plate>

          {groups.length > 0 && (
            <div className={s.sortRow}>
              <span className={s.sortLabel}>Сначала</span>
              <Segmented<SortKey>
                block
                label="Порядок клиентов"
                layoutId="report-sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'name', label: 'Имя' },
                  { value: 'accepted', label: 'Заявки' },
                  { value: 'refills', label: 'Картриджи' },
                  { value: 'declined', label: 'Без рем.' },
                ]}
              />
            </div>
          )}

          {groups.map((g) => (
            <section key={g.id} className={s.group} aria-label={g.title}>
              <h3 className={s.groupHead}>
                <i className={cx(s.dot, g.id === 'legal' ? s.splitLegal : g.id === 'person' ? s.splitPerson : s.dotAll)} />
                {g.title}
                <span className={s.groupCount}>{g.rows.length}</span>
              </h3>
              <ul className={s.list}>
                {g.rows.map((r, i) => (
                  <li key={r.clientId}>
                    <button type="button" className={cx('lg', s.row)} onClick={() => setOpenId(r.clientId)}>
                      <span className={cx(s.avatar, r.kind === 'legal' ? s.avLegal : s.avPerson)} aria-hidden>
                        {initials(r.clientName)}
                      </span>
                      <span className={s.who}>
                        <span className={s.name}>{r.clientName}</span>
                        <span className={s.sub}>
                          {g.id === 'all' && <b className={s.rank}>{i + 1} место · </b>}
                          техники в базе: {r.devices}
                        </span>
                      </span>
                      <span className={s.metrics}>
                        <Metric value={r.accepted} name="заявки" active={sort === 'accepted'} />
                        <Metric value={r.repaired} name="ремонты" />
                        <Metric value={r.refills} name="картриджи" active={sort === 'refills'} />
                        <Metric value={r.declined} name="без рем." title="Без ремонта: клиент отказался" active={sort === 'declined'} />
                        <Metric value={r.visits} name="выезды" title="Закрытые выезды к клиенту" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {!groups.length && (
            <EmptyState icon={<BarChart3 />} title="За этот месяц данных нет">
              Отчёт строится из заявок и журнала техники. Если заправки не записывать, они не попадут в отчёт.
            </EmptyState>
          )}
        </>
      )}

      <ClientReportSheet clientId={openId} month={month} onClose={() => setOpenId(null)} />
    </>
  );
}

function reportCsv(report: MonthlyReport, scope: Scope) {
  const head = ['Клиент', 'Тип', 'Принято заявок', 'Ремонтов', 'Без ремонта', 'Картриджей', 'Выездов'];
  const rows = report.rows
    .filter((r) => scope === 'all' || r.kind === scope)
    .map((r) => [r.clientName, r.kind === 'legal' ? 'Юрлицо' : 'Физлицо', r.accepted, r.repaired, r.declined, r.refills, r.visits]);
  return [head, ...rows];
}
