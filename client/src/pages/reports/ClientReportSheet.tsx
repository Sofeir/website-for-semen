import { Download, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { WORK_KIND_LABELS } from '@sd/shared';
import { useClientReport } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ErrorBox, Pill, Spinner } from '@/ui/Display';
import { Sheet } from '@/ui/Sheet';
import { downloadCsv, label } from './reportUtils';
import s from './ClientReportSheet.module.css';

/** Подробности по одной организации за месяц: что именно сделали. Основа для счёта. */
export function ClientReportSheet({ clientId, month, onClose }: { clientId: number | null; month: string; onClose: () => void }) {
  const q = useClientReport(clientId, month);
  const r = q.data;
  const refillTotal = r?.refills.reduce((sum, x) => sum + x.qty, 0) ?? 0;
  const empty = r && !r.refills.length && !r.works.length && !r.orders.length;

  const csv = () => {
    if (!r) return;
    const rows: (string | number)[][] = [['Что', 'Техника', 'Пробег, стр.', 'Количество']];
    for (const x of r.refills) rows.push([`Заправка ${x.title}`, '', '', x.qty]);
    for (const w of r.works) rows.push([`${WORK_KIND_LABELS[w.kind]}: ${w.title}`, w.deviceTitle ?? '', w.counter ?? '', w.qty]);
    for (const o of r.orders) rows.push([`Заявка №${o.number}: ${o.outcome === 'declined' ? 'без ремонта' : 'ремонт выполнен'}`, o.deviceTitle, '', 1]);
    downloadCsv(`schet-${r.clientName.replace(/[^\p{L}\p{N}]+/gu, '-')}-${r.month}.csv`, rows);
  };

  return (
    <Sheet
      open={clientId !== null}
      onClose={onClose}
      title={r?.clientName ?? 'Клиент'}
      subtitle={`${label(month)}: что сделали, для счёта`}
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
      {empty && <p className="muted">За этот месяц по клиенту ничего не записано.</p>}
      {r && !empty && (
        <div className="stack">
          {r.refills.length > 0 && (
            <section aria-label="Заправка картриджей">
              <h3 className={s.h}>Заправка картриджей</h3>
              {r.refills.map((x) => (
                <div key={x.title} className={s.line}>
                  <span>{x.title}</span>
                  <b>{x.qty} шт</b>
                </div>
              ))}
              <div className={`${s.line} ${s.sum}`}>
                <span>Всего заправлено</span>
                <b>{refillTotal} шт</b>
              </div>
            </section>
          )}
          {r.works.length > 0 && (
            <section aria-label="Работы и замены">
              <h3 className={s.h}>Работы и замены</h3>
              {r.works.map((w) => (
                <div key={w.id} className={s.line}>
                  <span className={s.what}>
                    {w.title}
                    <span className={s.sub}>
                      {[w.deviceTitle, w.counter !== null && `пробег ${w.counter.toLocaleString('ru-RU')} стр.`, fmtWhen(w.doneAt)]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </span>
                  <span className={s.kind}>
                    <Pill tone="outline">{WORK_KIND_LABELS[w.kind]}</Pill>
                    <b>{w.qty > 1 ? `${w.qty} шт` : '1'}</b>
                  </span>
                </div>
              ))}
            </section>
          )}
          {r.orders.length > 0 && (
            <section aria-label="Заявки">
              <h3 className={s.h}>Заявки в работе за месяц</h3>
              {r.orders.map((o) => (
                <div key={`${o.id}-${o.doneAt}`} className={s.line}>
                  <span className={s.what}>
                    <Link to={`/orders/${o.id}`} onClick={onClose}>
                      №{o.number}
                    </Link>{' '}
                    {o.deviceTitle}
                    <span className={s.sub}>{fmtWhen(o.doneAt)}</span>
                  </span>
                  <Pill tone={o.outcome === 'declined' ? 'amber' : 'teal'}>{o.outcome === 'declined' ? 'без ремонта' : 'ремонт выполнен'}</Pill>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
