import { Download, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { REFILL_OP_LABELS, WORK_KIND_LABELS, formatMoney, type ClientReportWork, type RefillOp } from '@sd/shared';
import { useClientReport } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ErrorBox, Pill, Spinner } from '@/ui/Display';
import { Sheet } from '@/ui/Sheet';
import { downloadCsv, label } from './reportUtils';
import s from './ClientReportSheet.module.css';

const opsLine = (w: ClientReportWork) => w.ops.map((o) => REFILL_OP_LABELS[o as RefillOp] ?? o).join(', ');

/** Строка работы: ведёт на заявку, если она есть. */
function WorkLine({ w, orderId, onClose }: { w: ClientReportWork; orderId: number | null; onClose: () => void }) {
  const body = (
    <>
      <span className={s.what}>
        {w.title}
        {w.qty > 1 ? ` × ${w.qty}` : ''}
        <span className={s.sub}>
          {[w.deviceTitle, w.counter !== null && `пробег ${w.counter.toLocaleString('ru-RU')} стр.`, fmtWhen(w.doneAt)].filter(Boolean).join(', ')}
        </span>
      </span>
      <span className={s.kind}>
        <Pill tone="outline">{WORK_KIND_LABELS[w.kind]}</Pill>
        {w.amount !== null && <b>{formatMoney(w.amount)}</b>}
      </span>
    </>
  );
  return orderId ? (
    <Link to={`/orders/${orderId}`} className={`${s.line} ${s.link}`} onClick={onClose}>
      {body}
    </Link>
  ) : (
    <div className={s.line}>{body}</div>
  );
}

/**
 * Подробности по одному клиенту за месяц. Сверху те же цифры, что в строке отчёта.
 * Ниже то, из чего они сложились: заправки, заявки с их работами и прочие работы.
 * Каждая запись ведёт на свою заявку.
 */
export function ClientReportSheet({ clientId, month, onClose }: { clientId: number | null; month: string; onClose: () => void }) {
  const q = useClientReport(clientId, month);
  const r = q.data;
  const empty = r && !r.orders.length && !r.refills.length && !r.otherWorks.length;

  const csv = () => {
    if (!r) return;
    const rows: (string | number)[][] = [['Раздел', 'Заявка', 'Техника', 'Что сделано', 'Количество', 'Сумма, руб.', 'Дата']];
    const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');
    const what = (w: ClientReportWork) => `${WORK_KIND_LABELS[w.kind]}: ${w.title}`;
    for (const x of r.refills) {
      rows.push(['Заправка картриджей', x.orderNumber ?? '', '', [x.title, opsLine(x)].filter(Boolean).join(': '), x.qty, x.amount ?? '', date(x.doneAt)]);
    }
    for (const o of r.orders) {
      const status = o.outcome === 'declined' ? 'без ремонта' : o.outcome === 'repaired' ? 'ремонт выполнен' : o.acceptedInMonth ? 'принята' : o.stageName;
      rows.push(['Заявка', o.number, o.deviceTitle, status, 1, '', date(o.outcomeAt ?? o.createdAt)]);
      for (const w of o.works) rows.push(['Работа по заявке', o.number, w.deviceTitle ?? o.deviceTitle, what(w), w.qty, w.amount ?? '', date(w.doneAt)]);
    }
    for (const w of r.otherWorks) rows.push(['Прочая работа', w.orderNumber ?? '', w.deviceTitle ?? '', what(w), w.qty, w.amount ?? '', date(w.doneAt)]);
    downloadCsv(`schet-${r.clientName.replace(/[^\p{L}\p{N}]+/gu, '-')}-${r.month}.csv`, rows);
  };

  return (
    <Sheet
      open={clientId !== null}
      onClose={onClose}
      title={r?.clientName ?? 'Клиент'}
      subtitle={`${label(month)}: из чего сложились цифры отчёта`}
      full
      width={620}
      footer={
        <>
          {r && (
            <Link to={`/clients/${r.clientId}`} className={s.open} onClick={onClose}>
              <ExternalLink size={16} aria-hidden /> Открыть клиента
            </Link>
          )}
          <Button icon={<Download size={18} aria-hidden />} onClick={csv} disabled={!r || Boolean(empty)}>
            Скачать CSV
          </Button>
        </>
      }
    >
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox error={q.error} />}
      {r && (
        <div className={`stack ${s.root}`}>
          <div className={s.totals}>
            <div>
              <b>{r.totals.accepted}</b>
              <span>заявки</span>
            </div>
            <div>
              <b>{r.totals.repaired}</b>
              <span>ремонты</span>
            </div>
            <div>
              <b>{r.totals.refills}</b>
              <span>картриджи</span>
            </div>
            <div>
              <b>{r.totals.declined}</b>
              <span>без рем.</span>
            </div>
          </div>
          {empty && <p className="muted">За этот месяц по клиенту ничего не записано.</p>}

          {r.refills.length > 0 && (
            <section aria-label="Заправка картриджей">
              <h3 className={s.h}>Заправка картриджей: {r.totals.refills} шт</h3>
              {r.refills.map((x) => {
                const ops = opsLine(x);
                return <WorkLine key={x.id} w={{ ...x, title: ops ? `${x.title} (${ops})` : x.title }} orderId={x.orderId} onClose={onClose} />;
              })}
              {r.refills.some((x) => !x.orderId) && <p className={s.note}>Записи без ссылки сделаны без заявки.</p>}
            </section>
          )}

          {r.orders.length > 0 && (
            <section aria-label="Заявки">
              <h3 className={s.h}>Заявки</h3>
              <p className={s.note}>
                Принятые в этом месяце и те, по которым в этом месяце закончен ремонт или клиент отказался. Принятых: {r.totals.accepted}, ремонтов: {r.totals.repaired}.
              </p>
              {r.orders.map((o) => (
                <div key={o.id} className={s.order}>
                  <Link to={`/orders/${o.id}`} className={`${s.line} ${s.link}`} onClick={onClose}>
                    <span className={s.what}>
                      <b className={s.num}>№{o.number}</b> {o.deviceTitle}
                      <span className={s.sub}>
                        принята {fmtWhen(o.createdAt)}, сейчас: {o.stageName}
                      </span>
                    </span>
                    <span className={s.tags}>
                      {o.acceptedInMonth && <Pill tone="outline">принята</Pill>}
                      {o.outcome && <Pill tone={o.outcome === 'declined' ? 'amber' : 'teal'}>{o.outcome === 'declined' ? 'без ремонта' : 'ремонт выполнен'}</Pill>}
                    </span>
                  </Link>
                  {o.works.length > 0 && (
                    <div className={s.nested}>
                      {o.works.map((w) => (
                        <WorkLine key={w.id} w={w} orderId={o.id} onClose={onClose} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {r.otherWorks.length > 0 && (
            <section aria-label="Прочие работы">
              <h3 className={s.h}>Прочие работы</h3>
              {r.otherWorks.map((w) => (
                <WorkLine key={w.id} w={w} orderId={w.orderId} onClose={onClose} />
              ))}
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
