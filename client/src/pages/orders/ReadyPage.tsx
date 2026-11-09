import { useEffect, useMemo, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { useDictionaries, useOrders } from '@/api/queries';
import { useDocumentTitle, useIsMobile } from '@/lib/hooks';
import { CARTRIDGE_TYPE } from '@/lib/stages';
import { BulkIssueSheet } from '@/components/BulkIssueSheet';
import { OrderRow } from '@/components/OrderRow';
import { Button } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/ui/Display';
import { Checkbox, Segmented } from '@/ui/Form';
import s from './Ready.module.css';

type Kind = 'all' | 'equipment' | 'cartridges';
type Result = 'all' | 'repaired' | 'declined';

/** Готовая техника: заявки на этапе «Готово», которые ждут выдачи клиенту. Выбранные можно выдать разом. */
export default function ReadyPage() {
  useDocumentTitle('Готовая техника');
  const mobile = useIsMobile();
  const dict = useDictionaries();
  const ready = dict.data?.stages.find((st) => st.isActive && st.code === 'ready');
  const orders = useOrders({ stage: ready?.id ?? '', sort: 'old' }, Boolean(ready));
  const [kind, setKind] = useState<Kind>('all');
  const [result, setResult] = useState<Result>('all');
  const [picked, setPicked] = useState<number[]>([]);
  const [issuing, setIssuing] = useState(false);

  const all = orders.data ?? [];
  const byKind = useMemo(
    () => ({
      all,
      equipment: all.filter((o) => o.deviceType !== CARTRIDGE_TYPE),
      cartridges: all.filter((o) => o.deviceType === CARTRIDGE_TYPE),
    }),
    [all],
  );

  const list = byKind[kind];
  const shown = result === 'all' ? list : list.filter((o) => o.outcome === result);
  const count = (r: Result) => (r === 'all' ? list.length : list.filter((o) => o.outcome === r).length);

  // Выбор не должен пережить закрытие заявок или смену списка: оставляем только то, что видно
  const shownIds = shown.map((o) => o.id);
  const shownKey = shownIds.join(',');
  useEffect(() => {
    setPicked((p) => p.filter((id) => shownIds.includes(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  const chosen = shown.filter((o) => picked.includes(o.id));
  const allOn = shown.length > 0 && chosen.length === shown.length;
  const toggle = (id: number, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  return (
    <>
      <PageHeader title="Готовая техника" subtitle="Ждёт выдачи клиенту: этап «Готово»" />
      <div className={s.toolbar}>
        <Tabs
          label="Вид"
          value={kind}
          onChange={setKind}
          items={[
            { value: 'all', label: 'Все', count: byKind.all.length },
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
            { value: 'all', label: mobile ? 'Все' : `Все ${count('all')}` },
            { value: 'repaired', label: mobile ? 'С ремонтом' : `С ремонтом ${count('repaired')}` },
            { value: 'declined', label: mobile ? 'Без ремонта' : `Без ремонта ${count('declined')}` },
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
          <div className={s.selectBar}>
            <Checkbox
              checked={allOn}
              onChange={(e) => setPicked(e.target.checked ? shownIds : [])}
              label={chosen.length ? `Выбрано: ${chosen.length}` : 'Выбрать все'}
            />
            {chosen.length > 0 && (
              <Button variant="success" size="sm" onClick={() => setIssuing(true)}>
                Выдать выбранные
              </Button>
            )}
          </div>
          <div className={s.list}>
            {shown.map((o) => (
              <OrderRow key={o.id} order={o} showStage={false} select={{ checked: picked.includes(o.id), onChange: (on) => toggle(o.id, on) }} />
            ))}
          </div>
        </Card>
      )}
      <BulkIssueSheet
        orders={issuing ? chosen : []}
        onClose={() => setIssuing(false)}
        onDone={(done) => setPicked((p) => p.filter((id) => !done.includes(id)))}
      />
    </>
  );
}
