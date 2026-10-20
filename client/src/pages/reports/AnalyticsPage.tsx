import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, LineChart, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Analytics, AnalyticsTotals } from '@sd/shared';
import { useAnalytics } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { Avatar, Card, CardHead, EmptyState, ErrorBox, PageHeader, Pill, Plate, Spinner } from '@/ui/Display';
import { Button, IconButton, cx } from '@/ui/Button';
import { Segmented, Select } from '@/ui/Form';
import { downloadCsv, label, monthShift, thisMonth } from './reportUtils';
import s from './Analytics.module.css';

type MetricKey = keyof AnalyticsTotals;
type Mode = 'prev' | 'year' | 'custom';

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const rub = (n: number) => `${nf.format(Math.round(n))} ₽`;
const days = (n: number | null) => (n === null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('ru-RU')} дн.`);

interface Metric {
  key: MetricKey;
  label: string;
  /** Короткая подпись для плашки сверху. */
  short: string;
  /** Подпись на переключателе динамики. */
  trendLabel?: string;
  fmt: (n: number | null) => string;
  /** Что считать хорошим: рост или падение. */
  good: 'up' | 'down' | 'none';
}

const METRICS: Metric[] = [
  { key: 'revenue', label: 'Выручка', short: 'Выручка', trendLabel: 'Выручка', fmt: (n) => rub(n ?? 0), good: 'up' },
  { key: 'requests', label: 'Принято заявок', short: 'Заявок', trendLabel: 'Заявки', fmt: (n) => nf.format(n ?? 0), good: 'up' },
  { key: 'repaired', label: 'Отремонтировано', short: 'Ремонтов', trendLabel: 'Ремонты', fmt: (n) => nf.format(n ?? 0), good: 'up' },
  { key: 'declined', label: 'Без ремонта', short: 'Без ремонта', fmt: (n) => nf.format(n ?? 0), good: 'down' },
  { key: 'refills', label: 'Картриджей заправлено', short: 'Картриджей', trendLabel: 'Картриджи', fmt: (n) => nf.format(n ?? 0), good: 'up' },
  { key: 'works', label: 'Работ записано', short: 'Работ', fmt: (n) => nf.format(n ?? 0), good: 'none' },
  { key: 'avgDays', label: 'Средний срок ремонта', short: 'Срок ремонта', fmt: days, good: 'down' },
  { key: 'warrantyReturns', label: 'Возвратов по гарантии', short: 'Возвратов', fmt: (n) => nf.format(n ?? 0), good: 'down' },
  { key: 'activeClients', label: 'Обращавшихся клиентов', short: 'Клиентов', fmt: (n) => nf.format(n ?? 0), good: 'up' },
];
const byKey = (k: MetricKey) => METRICS.find((m) => m.key === k)!;

const TREND_METRICS: MetricKey[] = ['revenue', 'requests', 'repaired', 'refills'];

const shortMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(y, mo - 1, 1)).replace('.', '').slice(0, 3);
};

/** Изменение к сравниваемому месяцу: процент и направление (хорошо или плохо зависит от показателя). */
function delta(cur: number | null, prev: number | null, good: Metric['good']) {
  const c = cur ?? 0;
  const p = prev ?? 0;
  if (c === p) return { text: 'без изменений', dir: 0, tone: 'flat' as const };
  const dir = c > p ? 1 : -1;
  const text = p === 0 ? 'новое' : `${dir > 0 ? '+' : '−'}${Math.round((Math.abs(c - p) / p) * 100)}%`;
  const tone = good === 'none' ? ('flat' as const) : (good === 'up') === (dir > 0) ? ('good' as const) : ('bad' as const);
  return { text, dir, tone };
}

function Delta({ cur, prev, good, onDark }: { cur: number | null; prev: number | null; good: Metric['good']; onDark?: boolean }) {
  const d = delta(cur, prev, good);
  const Icon = d.dir > 0 ? TrendingUp : d.dir < 0 ? TrendingDown : Minus;
  return (
    <span className={cx(s.delta, s[d.tone], onDark && s.onDark)}>
      <Icon size={14} aria-hidden />
      {d.text}
    </span>
  );
}

/** Главные цифры месяца на тёмной стеклянной плашке, с изменением к выбранному месяцу. */
function Hero({ a }: { a: Analytics }) {
  return (
    <Plate className={s.hero}>
      {(['revenue', 'requests', 'repaired', 'avgDays'] as MetricKey[]).map((k) => {
        const m = byKey(k);
        return (
          <div key={k} className={s.heroStat}>
            <span className={s.heroLabel}>{m.short}</span>
            <b className={s.heroNum}>{m.fmt(a.current[k])}</b>
            <span className={s.heroNote}>
              <Delta cur={a.current[k]} prev={a.previous[k]} good={m.good} onDark /> к {label(a.compare).toLowerCase()}
            </span>
          </div>
        );
      })}
    </Plate>
  );
}

/** Месяц против месяца: пары полос и изменение по каждому показателю. */
function Compare({ a }: { a: Analytics }) {
  return (
    <Card>
      <CardHead title="Месяц против месяца" />
      <div className={s.legendRow}>
        <span>
          <i className={s.dotNow} /> {label(a.month)}
        </span>
        <span>
          <i className={s.dotPrev} /> {label(a.compare)}
        </span>
      </div>
      <ul className={s.cmpList}>
        {METRICS.map((m) => {
          const cur = a.current[m.key] ?? 0;
          const prev = a.previous[m.key] ?? 0;
          const max = Math.max(cur, prev, 1);
          return (
            <li key={m.key} className={s.cmpRow}>
              <div className={s.cmpHead}>
                <span className={s.cmpName}>{m.label}</span>
                <Delta cur={a.current[m.key]} prev={a.previous[m.key]} good={m.good} />
              </div>
              <div className={s.cmpBars} aria-hidden>
                <i className={s.barNow} style={{ width: `${Math.max((cur / max) * 100, cur ? 3 : 0)}%` }} />
                <i className={s.barPrev} style={{ width: `${Math.max((prev / max) * 100, prev ? 3 : 0)}%` }} />
              </div>
              <div className={s.cmpNums}>
                <b>{m.fmt(a.current[m.key])}</b>
                <span>{m.fmt(a.previous[m.key])}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Динамика за год: столбцы по месяцам, выбранный и сравниваемый подсвечены. */
function Trend({ a }: { a: Analytics }) {
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const m = byKey(metric);
  const values = a.trend.map((p) => p[metric] ?? 0);
  const max = Math.max(...values, 1);
  const total = values.reduce((x, y) => x + y, 0);
  return (
    <Card>
      <CardHead title="Динамика за год" />
      <div className={s.metricTabs} role="radiogroup" aria-label="Показатель">
        {TREND_METRICS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={metric === k}
            className={cx(s.metricTab, metric === k && s.metricTabOn)}
            onClick={() => setMetric(k)}
          >
            {byKey(k).trendLabel}
          </button>
        ))}
      </div>
      <p className={s.trendTotal}>
        За 12 месяцев: <b>{m.fmt(total)}</b>
      </p>
      <div className={s.chart} role="img" aria-label={`${m.label} по месяцам`}>
        {a.trend.map((p, i) => {
          const v = values[i];
          const sel = p.month === a.month;
          const cmp = p.month === a.compare;
          return (
            <div key={p.month} className={cx(s.col, sel && s.colSel, cmp && s.colCmp)} title={`${label(p.month)}: ${m.fmt(v)}`}>
              <span className={s.colVal}>{sel || cmp ? (metric === 'revenue' ? nf.format(Math.round(v / 1000)) + 'к' : v) : ''}</span>
              <i className={s.colBar} style={{ height: `${Math.max((v / max) * 100, v ? 3 : 1)}%` }} />
              <span className={s.colLabel}>{shortMonth(p.month)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Masters({ a }: { a: Analytics }) {
  const max = Math.max(...a.masters.map((m) => m.revenue), 1);
  return (
    <Card>
      <CardHead title="Инженеры за месяц" count={a.masters.length} />
      {a.masters.length ? (
        <ul className={s.people}>
          {a.masters.map((m) => (
            <li key={m.userId} className={s.person}>
              <Avatar name={m.name} size={40} />
              <div className={s.personMain}>
                <div className={s.personHead}>
                  <b>{m.name}</b>
                  <span className={s.personSum}>{rub(m.revenue)}</span>
                </div>
                {m.position && <span className={s.muted}>{m.position}</span>}
                <i className={s.personBar} style={{ width: `${Math.max((m.revenue / max) * 100, m.revenue ? 4 : 0)}%` }} />
                <span className={s.personStats}>
                  работ {m.works} · заявок {m.orders} · картриджей {m.refills} · этапов {m.stages}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">За этот месяц никто не записал работы.</p>
      )}
    </Card>
  );
}

function Devices({ a }: { a: Analytics }) {
  return (
    <Card>
      <CardHead title="На что уходят деньги: техника" count={a.devices.length} />
      {a.devices.length ? (
        <ol className={s.rank}>
          {a.devices.map((d, i) => (
            <li key={d.deviceId} className={s.rankRow}>
              <span className={s.rankNo}>{i + 1}</span>
              <div className={s.rankMain}>
                <b>
                  {d.inventoryNo ? `${d.inventoryNo}: ` : ''}
                  {d.title}
                </b>
                <span className={s.muted}>
                  <Link to={`/clients/${d.clientId}`}>{d.clientName}</Link>, работ {d.works}
                </span>
              </div>
              <div className={s.rankEnd}>
                <b>{rub(d.revenue)}</b>
                {d.early > 0 && (
                  <Pill tone="red" dot>
                    раньше срока ×{d.early}
                  </Pill>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Пока нет записей работ с суммами.</p>
      )}
    </Card>
  );
}

function Early({ a }: { a: Analytics }) {
  return (
    <Card>
      <CardHead title="Замены раньше расчётного срока" count={a.early.length} />
      <p className="muted">Деталь сменили, не выработав ресурс. Тут видно, что ответить клиенту, когда он говорит «недавно же меняли».</p>
      {a.early.length ? (
        <ul className={s.earlyList}>
          {a.early.map((e, i) => {
            const pct = Math.min(Math.round((e.passed / e.resource) * 100), 100);
            return (
              <li key={`${e.deviceId}-${i}`} className={s.earlyRow}>
                <div className={s.rankMain}>
                  <b>{e.part}</b>
                  <span className={s.muted}>
                    {e.title}, {e.clientName}
                  </span>
                </div>
                <i className={s.earlyBar} aria-hidden>
                  <i style={{ width: `${Math.max(pct, 4)}%` }} />
                </i>
                <span className={s.earlyNote}>
                  Прошло {nf.format(e.passed)} из {nf.format(e.resource)} стр. ({pct}%)
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Таких замен нет. Чтобы они считались, указывайте ресурс детали при записи замены.</p>
      )}
    </Card>
  );
}

function Clients({ a }: { a: Analytics }) {
  return (
    <Card>
      <CardHead title="Клиенты" count={a.clients.length} />
      {a.clients.length ? (
        <ol className={s.rank}>
          {a.clients.map((c, i) => (
            <li key={c.clientId} className={s.rankRow}>
              <span className={s.rankNo}>{i + 1}</span>
              <div className={s.rankMain}>
                <b>
                  <Link to={`/clients/${c.clientId}`}>{c.name}</Link>
                </b>
                <span className={s.muted}>
                  заявок за период {c.requests}, всего {c.allTime}
                </span>
              </div>
              <div className={s.rankEnd}>
                <b>{rub(c.revenue)}</b>
                {c.regular && <Pill tone="teal">постоянный</Pill>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Нет данных за период.</p>
      )}
    </Card>
  );
}

function analyticsCsv(a: Analytics): (string | number)[][] {
  const rows: (string | number)[][] = [['Показатель', label(a.month), label(a.compare)]];
  for (const m of METRICS) rows.push([m.label, m.fmt(a.current[m.key]), m.fmt(a.previous[m.key])]);
  rows.push([], ['Динамика по месяцам', 'Заявок', 'Ремонтов', 'Без ремонта', 'Картриджей', 'Выручка, руб.']);
  for (const p of a.trend) rows.push([label(p.month), p.requests, p.repaired, p.declined, p.refills, Math.round(p.revenue)]);
  rows.push([], ['Инженер', 'Должность', 'Работ', 'Заявок', 'Картриджей', 'Выручка, руб.']);
  for (const m of a.masters) rows.push([m.name, m.position ?? '', m.works, m.orders, m.refills, Math.round(m.revenue)]);
  rows.push([], ['Техника', 'Клиент', 'Работ', 'Выручка, руб.', 'Замен раньше срока']);
  for (const d of a.devices) rows.push([`${d.inventoryNo ? d.inventoryNo + ' ' : ''}${d.title}`, d.clientName, d.works, Math.round(d.revenue), d.early]);
  rows.push([], ['Клиент', 'Заявок за период', 'Заявок всего', 'Выручка, руб.']);
  for (const c of a.clients) rows.push([c.name, c.requests, c.allTime, Math.round(c.revenue)]);
  return rows;
}

/**
 * Аналитика для руководителя: что изменилось к прошлому месяцу, как шёл год, кто сколько сделал,
 * какая техника дорого обходится и где детали меняют раньше срока. Деньги берутся из сумм в журнале работ.
 */
export default function AnalyticsPage() {
  useDocumentTitle('Аналитика');
  const [month, setMonth] = useState(thisMonth);
  const [mode, setMode] = useState<Mode>('prev');
  const [custom, setCustom] = useState(() => monthShift(thisMonth(), -2));
  const [span, setSpan] = useState<'3' | '6' | '12'>('12');
  const compare = mode === 'prev' ? monthShift(month, -1) : mode === 'year' ? monthShift(month, -12) : custom;
  const q = useAnalytics(month, compare, Number(span));
  const a = q.data;
  const options = useMemo(() => Array.from({ length: 36 }, (_, i) => monthShift(month, -(i + 1))), [month]);

  return (
    <>
      <PageHeader
        title="Аналитика"
        subtitle="Месяц против месяца, деньги, инженеры, техника и клиенты. Суммы берутся из записей работ."
        actions={
          <Button variant="secondary" icon={<Download size={18} aria-hidden />} onClick={() => a && downloadCsv(`analitika-${month}.csv`, analyticsCsv(a))} disabled={!a}>
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
        <div className={s.compareBar}>
          <span className={s.muted}>Сравнить с</span>
          <Segmented<Mode>
            label="С чем сравнить"
            layoutId="analytics-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'prev', label: 'Прошлым' },
              { value: 'year', label: 'Годом назад' },
              { value: 'custom', label: 'Другим' },
            ]}
          />
          {mode === 'custom' && (
            <Select aria-label="Месяц для сравнения" value={custom} onChange={(e) => setCustom(e.target.value)}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {q.isLoading && !a && <Spinner />}
      {q.isError && <ErrorBox error={q.error} />}
      {a && (
        <>
          <Hero a={a} />
          {a.current.requests + a.current.works === 0 && (
            <EmptyState icon={<LineChart />} title="В этом месяце пока пусто">Выберите другой месяц стрелками. Цифры появятся, когда будут заявки и записи работ.</EmptyState>
          )}
          <div className={s.grid}>
            <Compare a={a} />
            <Trend a={a} />
          </div>
          <div className={s.spanBar}>
            <span className={s.muted}>Техника и клиенты за</span>
            <Segmented<'3' | '6' | '12'>
              label="Период для техники и клиентов"
              layoutId="analytics-span"
              value={span}
              onChange={setSpan}
              options={[
                { value: '3', label: '3 мес.' },
                { value: '6', label: '6 мес.' },
                { value: '12', label: 'Год' },
              ]}
            />
          </div>
          <div className={s.grid}>
            <Masters a={a} />
            <Devices a={a} />
            <Early a={a} />
            <Clients a={a} />
          </div>
        </>
      )}
    </>
  );
}
