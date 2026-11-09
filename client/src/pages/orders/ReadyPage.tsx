import { useMemo, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { useDictionaries, useOrders } from '@/api/queries';
import { useDocumentTitle, useIsMobile } from '@/lib/hooks';
import { OrderRow } from '@/components/OrderRow';
import { Card, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/ui/Display';
import { Segmented } from '@/ui/Form';
import s from './Ready.module.css';

type Kind = 'equipment' | 'cartridges';
type Result = 'all' | 'repaired' | 'declined';

/** Тип «Картридж» в справочнике: их заправляют, а не ремонтируют, поэтому в списке они отдельно. */
const CARTRIDGE_TYPE = 'Картридж';

/** Готовая техника: заявки на этапе «Готово», которые ждут выдачи клиенту. */
export default function ReadyPage() {
  useDocumentTitle('Готовая техника');
  const mobile = useIsMobile();
  const dict = useDictionaries();
  const ready = dict.data?.stages.find((st) => st.isActive && st.code === 'ready');
  const orders = useOrders({ stage: ready?.id ?? '', sort: 'old' }, Boolean(ready));
  const [kind, setKind] = useState<Kind>('equipment');
  const [result, setResult] = useState<Result>('all');

  const byKind = useMemo(() => {
    const all = orders.data ?? [];
    return {
      equipment: all.filter((o) => o.deviceType !== CARTRIDGE_TYPE),
      cartridges: all.filter((o) => o.deviceType === CARTRIDGE_TYPE),
    };
  }, [orders.data]);

  const list = byKind[kind];
  const shown = result === 'all' ? list : list.filter((o) => o.outcome === result);
  const count = (r: Result) => (r === 'all' ? list.length : list.filter((o) => o.outcome === r).length);

  return (
    <>
      <PageHeader title="Готовая техника" subtitle="Ждёт выдачи клиенту: этап «Готово»" />
      <div className={s.toolbar}>
        <Tabs
          label="Вид"
          value={kind}
          onChange={setKind}
          items={[
            { value: 'equipment', label: 'Техника', count: byKind.equipment.length },
            { value: 'cartridges', label: 'Картриджи', count: byKind.cartridges.length },
          ]}
        />
        <Segmented
          label="Итог"
          block={mobile}
          layoutId="ready-result"
          value={result}
          onChange={setResult}
          options={[
            { value: 'all', label: `Все ${count('all')}` },
            { value: 'repaired', label: `С ремонтом ${count('repaired')}` },
            { value: 'declined', label: `Без ремонта ${count('declined')}` },
          ]}
        />
      </div>
      {dict.isLoading || orders.isLoading ? (
        <Spinner />
      ) : orders.isError ? (
        <ErrorBox error={orders.error} />
      ) : !shown.length ? (
        <EmptyState icon={<PackageCheck />} title="Готовой техники нет">
          Здесь появляется техника, которую уже сделали и пока не выдали.
        </EmptyState>
      ) : (
        <Card>
          <div className={s.list}>
            {shown.map((o) => (
              <OrderRow key={o.id} order={o} showStage={false} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
