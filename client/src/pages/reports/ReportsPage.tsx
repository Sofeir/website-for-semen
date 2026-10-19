import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { MonthlyReport, ReportRow, ReportTotals } from '@sd/shared';
import { useMonthlyReport } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, IconButton, cx } from '@/ui/Button';
import { EmptyState, ErrorBox, PageHeader, Spinner } from '@/ui/Display';
import { Segmented } from '@/ui/Form';
import { ClientReportSheet } from './ClientReportSheet';
import { downloadCsv, label, monthShift, thisMonth } from './reportUtils';
import s from './ReportsPage.module.css';

type Scope = 'all' | 'legal' | 'person';
type SortKey = 'clientName' | keyof ReportTotals;

/** Колонки таблицы. `opt` — на узком экране скрываются, они есть в подробностях по клиенту. */
const COLS: { key: keyof ReportTotals; label: string; short: string; opt?: boolean }[] = [
  { key: 'accepted', label: 'Принято заявок', short: 'Заявки' },
  { key: 'repaired', label: 'Ремонтов', short: 'Ремонты' },
  { key: 'declined', label: 'Без ремонта', short: 'Без рем.', opt: true },
  { key: 'refills', label: 'Картриджей', short: 'Картр.' },
  { key: 'parts', label: 'Замен деталей', short: 'Детали', opt: true },
  { key: 'otherWorks', label: 'Прочих работ', short: 'Прочее', opt: true },
];

const num = (n: number) => (n ? String(n) : '·');

function sortRows(rows: ReportRow[], key: SortKey, dir: 1 | -1) {
  return [...rows].sort((a, b) =>
    key === 'clientName' ? dir * a.clientName.localeCompare(b.clientName, 'ru') : dir * (a[key] - b[key]) || a.clientName.localeCompare(b.clientName, 'ru'),
  );
}

function Cells({ t, strong }: { t: ReportTotals; strong?: boolean }) {
  return (
    <>
      {COLS.map((c) => (
        <td key={c.key} className={cx(s.n, c.opt && s.opt, !t[c.key] && s.zero, strong && s.strong)}>
          {num(t[c.key])}
        </td>
      ))}
    </>
  );
}

/**
 * Помесячный отчёт одной таблицей: строка на клиента, юрлица и физлица отдельными блоками с подитогом, внизу всего.
 * Нажатие на клиента открывает подробности: что именно сделали, для счёта.
 */
export default function ReportsPage() {
  useDocumentTitle('Отчёты');
  const [month, setMonth] = useState(thisMonth);
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'clientName', dir: 1 });
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useMonthlyReport(month);
  const report = q.data;

  const groups = useMemo(() => {
    if (!report) return [];
    const list: { id: 'legal' | 'person'; title: string; rows: ReportRow[]; totals: ReportTotals }[] = [
      { id: 'legal', title: 'Юрлица', rows: [], totals: report.totals.legal },
      { id: 'person', title: 'Физлица', rows: [], totals: report.totals.person },
    ];
    for (const r of report.rows) list.find((g) => g.id === r.kind)!.rows.push(r);
    return list
      .filter((g) => (scope === 'all' || scope === g.id) && g.rows.length)
      .map((g) => ({ ...g, rows: sortRows(g.rows, sort.key, sort.dir) }));
  }, [report, scope, sort]);

  const total = report?.totals[scope];
  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: (cur.dir * -1) as 1 | -1 } : { key, dir: key === 'clientName' ? 1 : -1 }));

  const head = (key: SortKey, text: string, short: string, opt?: boolean, left?: boolean) => (
    <th key={key} className={cx(left ? s.left : s.n, opt && s.opt)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={s.sortBtn} onClick={() => toggleSort(key)} title={text}>
        <span className={s.full}>{text}</span>
        <span className={s.shortLabel}>{short}</span>
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />)}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        title="Отчёты"
        subtitle="По месяцам: заявки, ремонты, заправки картриджей. Нажмите на клиента, чтобы увидеть, что именно сделали."
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
            { value: 'all', label: 'Все вместе' },
            { value: 'legal', label: 'Юрлица' },
            { value: 'person', label: 'Физлица' },
          ]}
        />
      </div>

      {q.isError && <ErrorBox error={q.error} />}
      {!report && q.isLoading && <Spinner />}

      {report &&
        (groups.length ? (
          <div className={s.card}>
            <table className={s.table}>
              <thead>
                <tr>
                  {head('clientName', 'Клиент', 'Клиент', false, true)}
                  {COLS.map((c) => head(c.key, c.label, c.short, c.opt))}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.id}>
                  {scope === 'all' && (
                    <tr className={s.group}>
                      <td className={s.left}>
                        {g.title} <span className={cx(s.tag, g.id === 'legal' ? s.legal : s.person)}>{g.rows.length}</span>
                      </td>
                      <Cells t={g.totals} strong />
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r.clientId} className={s.row}>
                      <td className={s.left}>
                        <button type="button" className={s.client} onClick={() => setOpenId(r.clientId)}>
                          {r.clientName}
                        </button>
                      </td>
                      <Cells t={r} />
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className={s.total}>
                  <td className={s.left}>Всего</td>
                  <Cells t={total!} strong />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <EmptyState icon={<BarChart3 />} title="За этот месяц данных нет">
            Отчёт строится из заявок и журнала техники. Если заправки не записывать, они не попадут в отчёт.
          </EmptyState>
        ))}

      <ClientReportSheet clientId={openId} month={month} onClose={() => setOpenId(null)} />
    </>
  );
}

function reportCsv(report: MonthlyReport, scope: Scope) {
  const head = ['Клиент', 'Тип', 'Принято заявок', 'Ремонтов', 'Без ремонта', 'Картриджей', 'Замен деталей', 'Прочих работ'];
  const rows = report.rows
    .filter((r) => scope === 'all' || r.kind === scope)
    .map((r) => [r.clientName, r.kind === 'legal' ? 'Юрлицо' : 'Физлицо', r.accepted, r.repaired, r.declined, r.refills, r.parts, r.otherWorks]);
  return [head, ...rows];
}
