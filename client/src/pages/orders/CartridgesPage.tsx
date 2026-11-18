import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, Search } from 'lucide-react';
import type { OrderListItem } from '@sd/shared';
import { pluralRu } from '@sd/shared';
import { useOrders } from '@/api/queries';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import { BulkIssueSheet } from '@/components/BulkIssueSheet';
import { OrderRow } from '@/components/OrderRow';
import { Accordion, Card, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/ui/Display';
import { Button } from '@/ui/Button';
import { Checkbox, Input } from '@/ui/Form';
import s from './Cartridges.module.css';

type Status = 'new' | 'work' | 'ready' | 'issued';

const STATUSES: Status[] = ['new', 'work', 'ready', 'issued'];

/** «Новые»: принятые за последние 2 дня и ещё не выданные (так же считает «Сегодня»). */
const FRESH_MS = 2 * 24 * 3600 * 1000;

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
      new: all.filter((o) => !o.issuedAt && Date.now() - new Date(o.createdAt).getTime() < FRESH_MS),
      work: all.filter((o) => !o.issuedAt && o.stageCode !== 'ready'),
      ready: all.filter((o) => !o.issuedAt && o.stageCode === 'ready'),
      issued: all.filter((o) => Boolean(o.issuedAt)),
    }),
    [all],
  );
  const shown = byStatus[status];

  // Массовая выдача: на вкладке «Готово» заявки можно отметить и выдать за раз, как в «Готовой технике»
  const [picked, setPicked] = useState<number[]>([]);
  const [issuing, setIssuing] = useState(false);
  const readyIds = byStatus.ready.map((o) => o.id);
  const readyKey = readyIds.join(',');
  useEffect(() => {
    setPicked((p) => p.filter((id) => readyIds.includes(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);
  const chosen = byStatus.ready.filter((o) => picked.includes(o.id));
  const allOn = readyIds.length > 0 && chosen.length === readyIds.length;
  const toggle = (id: number, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

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
            { value: 'new', label: 'Новые', count: byStatus.new.length },
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
          {status === 'ready' && (
            <Card>
              <div className={s.selectBar}>
                <Checkbox
                  checked={allOn}
                  onChange={(e) => setPicked(e.target.checked ? readyIds : [])}
                  label={chosen.length ? `Выбрано: ${chosen.length}` : 'Выбрать все'}
                />
                {chosen.length > 0 && (
                  <Button variant="success" size="sm" onClick={() => setIssuing(true)}>
                    Выдать выбранные
                  </Button>
                )}
              </div>
            </Card>
          )}
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
                    <OrderRow
                      key={o.id}
                      order={o}
                      showStage={status !== 'ready'}
                      select={status === 'ready' ? { checked: picked.includes(o.id), onChange: (on) => toggle(o.id, on) } : undefined}
                    />
                  ))}
                </div>
              </Accordion>
            </Card>
          ))}
        </div>
      )}
      <BulkIssueSheet
        orders={issuing ? chosen : []}
        onClose={() => setIssuing(false)}
        onDone={(done) => setPicked((p) => p.filter((id) => !done.includes(id)))}
      />
    </>
  );
}
