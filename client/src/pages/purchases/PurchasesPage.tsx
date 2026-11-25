import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackagePlus, ShoppingCart } from 'lucide-react';
import { PURCHASE_STATUS_LABELS, type PurchaseItem, type PurchaseStatus } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { usePurchases } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { Button } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner, Tabs } from '@/ui/Display';
import { PurchaseFormSheet } from './PurchaseFormSheet';
import { PurchaseSheet } from './PurchaseSheet';
import s from './Purchases.module.css';

type Tab = 'wait' | 'open' | 'closed';

const TONE: Record<PurchaseStatus, string> = {
  approval: 'amber',
  buying: 'blue',
  delivery: 'sky',
  done: 'teal',
  rejected: 'red',
  cancelled: 'slate',
};

const isOpen = (p: PurchaseItem) => p.status === 'approval' || p.status === 'buying' || p.status === 'delivery';

export default function PurchasesPage() {
  useDocumentTitle('Закупки');
  const { can } = useAuth();
  const approver = can('purchases.approve');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('wait');
  const [creating, setCreating] = useState(false);
  const list = usePurchases(approver ? 'all' : 'mine');
  const openId = Number(params.get('open')) || null;

  const setOpen = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', String(id));
    else next.delete('open');
    setParams(next, { replace: true });
  };

  const items = list.data ?? [];
  const groups = useMemo(
    () => ({
      wait: items.filter((p) => p.waitingForMe),
      open: items.filter(isOpen),
      closed: items.filter((p) => !isOpen(p)),
    }),
    [items],
  );
  const shown = groups[tab];

  return (
    <>
      <PageHeader
        title="Закупки"
        subtitle={approver ? 'Заявки на покупку: согласуете вы' : 'Заявки на покупку: согласует директор'}
        actions={
          <Button size="sm" icon={<PackagePlus size={18} aria-hidden />} onClick={() => setCreating(true)}>
            Новая закупка
          </Button>
        }
      />
      <div className={s.toolbar}>
        <Tabs
          label="Закупки"
          grid
          value={tab}
          onChange={setTab}
          items={[
            { value: 'wait', label: 'Ждут меня', count: groups.wait.length },
            { value: 'open', label: approver ? 'Все открытые' : 'Мои открытые', count: groups.open.length },
            { value: 'closed', label: 'Закрытые' },
          ]}
        />
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingCart />}
            title={tab === 'wait' ? 'Вас никто не ждёт' : tab === 'open' ? 'Открытых закупок нет' : 'Закрытых закупок нет'}
          >
            {tab === 'closed' ? 'Здесь появятся завершённые, отклонённые и отменённые закупки.' : 'Чтобы что-то купить, нажмите «Новая закупка».'}
          </EmptyState>
        </Card>
      ) : (
        <Card className={s.list}>
          {shown.map((p) => (
            <button key={p.id} type="button" className={s.row} onClick={() => setOpen(p.id)}>
              <span className={s.main}>
                <span className={s.title}>{p.title}</span>
                <span className={s.meta}>
                  {[p.clientName && `Для: ${p.clientName}`, `Завёл: ${p.creatorName}`, p.buyerId !== p.creatorId && `Покупает: ${p.buyerName}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className={s.side}>
                <Pill tone={TONE[p.status]}>{PURCHASE_STATUS_LABELS[p.status]}</Pill>
                {p.waitingForMe ? <span className={s.wait}>Ждёт вас</span> : <span className={s.date}>{fmtWhen(p.updatedAt, false)}</span>}
              </span>
            </button>
          ))}
        </Card>
      )}

      <PurchaseFormSheet open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
      <PurchaseSheet id={openId} onClose={() => setOpen(null)} />
    </>
  );
}
