import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Wrench } from 'lucide-react';
import type { CustomerOrder } from '@sd/shared';
import { useCustomerOrder, useCustomerOrders } from '@/api/queries';
import { fmtDate, fmtWhen } from '@/lib/dates';
import { cx } from '@/ui/Button';
import { Card, CardHead, EmptyState, ErrorBox, Pill, Spinner } from '@/ui/Display';
import s from './Customer.module.css';

/** Карточка «Моя техника»: каждая плашка раскрывается и показывает этапы ремонта и подробности. */
export function OrdersPanel() {
  const orders = useCustomerOrders();
  const list = orders.data ?? [];
  return (
    <Card>
      <CardHead title="Моя техника" count={orders.data ? list.length : undefined} />
      {orders.isError ? (
        <ErrorBox error={orders.error} />
      ) : !orders.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState icon={<Wrench />} title="Техники в ремонте нет">
          Когда вы сдадите технику в сервис, она появится здесь вместе с этапом работы.
        </EmptyState>
      ) : (
        <div className={s.devices}>
          {list.map((o) => (
            <OrderItem key={o.id} o={o} />
          ))}
        </div>
      )}
    </Card>
  );
}

function OrderItem({ o }: { o: CustomerOrder }) {
  const [open, setOpen] = useState(false);
  const detail = useCustomerOrder(o.id, open);
  const d = detail.data;
  const panelId = `order-${o.id}`;

  return (
    <article className={cx(s.device, open && s.deviceOpen)}>
      <button type="button" className={s.deviceBtn} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className={s.deviceMain}>
          <span className={s.deviceTitle}>
            <span className={s.deviceNum}>№{o.number}</span>
            {o.deviceTitle}
          </span>
          <span className={s.deviceSub}>
            Принята {fmtDate(o.createdAt)}
            {o.issuedAt && ` · выдана ${fmtDate(o.issuedAt)}`}
          </span>
        </span>
        <Pill tone={o.stageColor} dot>
          {o.stageName}
        </Pill>
        <ChevronDown aria-hidden className={cx(s.chev, open && s.chevOpen)} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            role="region"
            className={s.deviceBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className={s.deviceInner}>
              {detail.isError ? (
                <ErrorBox error={detail.error} />
              ) : !d ? (
                <Spinner />
              ) : (
                <>
                  <ol className={s.steps} aria-label="Этапы ремонта">
                    {d.steps.map((st, i) => (
                      <li key={st.code} className={s.step} data-state={st.state}>
                        <span className={s.stepDot}>{st.state === 'done' ? <Check aria-hidden strokeWidth={3} /> : i + 1}</span>
                        <span className={s.stepText}>
                          <span className={s.stepName}>{st.name}</span>
                          {st.startedAt && st.state !== 'todo' && <span className={s.stepDate}>{fmtWhen(st.startedAt)}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <dl className={s.facts}>
                    <div>
                      <dt>Неисправность</dt>
                      <dd>{d.fault}</dd>
                    </div>
                    {d.serial && (
                      <div>
                        <dt>Серийный номер</dt>
                        <dd>{d.serial}</dd>
                      </div>
                    )}
                    {d.stageDueAt && (
                      <div>
                        <dt>Этап «{d.stageName}» планируем закончить</dt>
                        <dd>{fmtWhen(d.stageDueAt)}</dd>
                      </div>
                    )}
                    {d.responsibleName && (
                      <div>
                        <dt>Сейчас занимается</dt>
                        <dd>{d.responsibleName}</dd>
                      </div>
                    )}
                    {d.issuedAt && (
                      <div>
                        <dt>Выдана</dt>
                        <dd>{fmtWhen(d.issuedAt)}</dd>
                      </div>
                    )}
                  </dl>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
