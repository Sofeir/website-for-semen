import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, Search } from 'lucide-react';
import type { OrderListItem } from '@sd/shared';
import { pluralRu } from '@sd/shared';
import { useOrders } from '@/api/queries';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import { OrderRow } from '@/components/OrderRow';
import { Accordion, Card, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/ui/Display';
import { Input } from '@/ui/Form';
import s from './Cartridges.module.css';

type Status = 'work' | 'ready' | 'issued';

const STATUSES: Status[] = ['work', 'ready', 'issued'];

/** Сколько картриджей в заявке: число берём из текста «Заправка картриджей: 5 шт.», который пишется при приёме. */
const qtyOf = (o: OrderListItem) => {
  const m = /(\d+)\s*шт/.exec(o.fault);
  return m ? Number(m[1]) : 0;
};

interface Group {
  clientId: number;
  name: string;
  orders: OrderListItem[];
  qty: number;
}

/**
 * Картриджи отдельно от остальной техники: заявки на заправку по организациям.
 * В «Задачах», «Сегодня» и календаре задач по картриджам нет, они видны только здесь и в самих заявках.
 */
export default function CartridgesPage() {
  useDocumentTitle('Картриджи');
  const [params, setParams] = useSearchParams();
  const status: Status = STATUSES.find((x) => x === params.get('status')) ?? 'work';
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const orders = useOrders({ type: 'cartridge', q: dq, issued: 'all', sort: 'old', limit: 500 });

  const all = orders.data ?? [];
  const byStatus = useMemo(
    () => ({
      work: all.filter((o) => !o.issuedAt && o.stageCode !== 'ready'),
      ready: all.filter((o) => !o.issuedAt && o.stageCode === 'ready'),
      issued: all.filter((o) => Boolean(o.issuedAt)),
    }),
    [all],
  );
  const shown = byStatus[status];

  const groups = useMemo(() => {
    const map = new Map<number, Group>();
    for (const o of shown) {
      const g = map.get(o.clientId) ?? { clientId: o.clientId, name: o.clientName, orders: [], qty: 0 };
      g.orders.push(o);
      g.qty += qtyOf(o);
      map.set(o.clientId, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [shown]);

  const setStatus = (v: Status) => {
    const next = new URLSearchParams(params);
    if (v === 'work') next.delete('status');
    else next.set('status', v);
    setParams(next, { replace: true });
  };

  const total = shown.length;
  const subtitle = orders.data
    ? `${total} ${pluralRu(total, 'заявка', 'заявки', 'заявок')} · ${groups.length} ${pluralRu(groups.length, 'организация', 'организации', 'организаций')}`
    : undefined;

  return (
    <>
      <PageHeader title="Картриджи" subtitle={subtitle} />
      <div className={s.toolbar}>
        <Tabs
          label="Состояние"
          value={status}
          onChange={setStatus}
          items={[
            { value: 'work', label: 'В работе', count: byStatus.work.length },
            { value: 'ready', label: 'Готово', count: byStatus.ready.length },
            { value: 'issued', label: 'Выданные', count: byStatus.issued.length },
          ]}
        />
        <Input
          icon={<Search aria-hidden />}
          type="search"
          placeholder="Организация, модель, номер заявки"
          aria-label="Поиск картриджей"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={s.search}
        />
      </div>

      {orders.isError ? (
        <ErrorBox error={orders.error} />
      ) : !orders.data ? (
        <Spinner />
      ) : !groups.length ? (
        <Card>
          <EmptyState icon={<Printer />} title="Картриджей нет">
            {dq ? 'По такому запросу ничего не нашли.' : 'Здесь появляются заявки на заправку картриджей: их принимают в «Приёме», тип техники «Картридж».'}
          </EmptyState>
        </Card>
      ) : (
        <div className={s.groups}>
          {groups.map((g) => (
            <Card key={`${g.clientId}-${dq ? 'q' : ''}`}>
              <Accordion
                defaultOpen={Boolean(dq)}
                title={
                  <span className={s.org}>
                    <span className={s.orgName}>{g.name}</span>
                  </span>
                }
                meta={
                  <span className={s.meta}>
                    {g.orders.length} {pluralRu(g.orders.length, 'заявка', 'заявки', 'заявок')}
                    {g.qty > 0 && <> · {g.qty} шт</>}
                  </span>
                }
              >
                <div className={s.list}>
                  {g.orders.map((o) => (
                    <OrderRow key={o.id} order={o} showStage={status !== 'ready'} />
                  ))}
                </div>
              </Accordion>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
