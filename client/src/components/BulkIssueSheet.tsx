import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { OrderListItem } from '@sd/shared';
import { useMe } from '@/app/auth';
import { useBulkIssue, useDictionaries } from '@/api/queries';
import { CARTRIDGE_TYPE, preferRolesFor } from '@/lib/stages';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Checkbox, Field } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { UserSelect } from './Pickers';

/** Выдача нескольких готовых заявок за раз: поехали к клиентам и отдали технику и картриджи. */
export function BulkIssueSheet({
  orders,
  onClose,
  onDone,
}: {
  orders: OrderListItem[];
  onClose: () => void;
  onDone: (issuedIds: number[]) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const dict = useDictionaries();
  const bulk = useBulkIssue();
  const [who, setWho] = useState('');
  const [returned, setReturned] = useState(false);
  const [error, setError] = useState('');
  const open = orders.length > 0;
  const finalStage = (dict.data?.stages ?? []).find((st) => st.isActive && st.isFinal);

  useEffect(() => {
    if (!open) return;
    setWho(String(me.id));
    setReturned(false);
    setError('');
  }, [open, me.id]);

  const noAct = orders.filter((o) => o.deviceType !== CARTRIDGE_TYPE && o.actsCount === 0);

  const submit = async () => {
    setError('');
    if (!who) return setError('Выберите, кто выдаёт');
    if (!returned) return setError('Отметьте, что всё возвращено клиентам');
    if (!finalStage) return setError('Не найден этап выдачи. Обновите страницу');
    const res = await bulk.mutateAsync({ orderIds: orders.map((o) => o.id), finalStageId: finalStage.id, responsibleId: Number(who) });
    if (res.done.length) toast.success(res.done.length === 1 ? 'Заявка выдана' : `Выдано заявок: ${res.done.length}`);
    if (res.failed.length) {
      const byId = new Map(orders.map((o) => [o.id, o.number]));
      setError(res.failed.map((f) => `№${byId.get(f.id)}: ${f.message}`).join('\n'));
      onDone(res.done);
      return;
    }
    onDone(res.done);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={orders.length === 1 ? 'Выдать заявку' : `Выдать заявок: ${orders.length}`}
      subtitle={orders.length > 1 ? 'Все выбранные заявки закроются одним действием' : undefined}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={bulk.isPending} icon={<ArrowRight size={18} aria-hidden />} variant="success">
            Выдать
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>
          {orders.map((o) => (
            <li key={o.id}>
              <strong>№{o.number}</strong> {o.deviceTitle}
              <span className="muted"> · {o.clientName}</span>
            </li>
          ))}
        </ul>
        {noAct.length > 0 && (
          <ErrorBox>
            Нет акта выполненных работ: {noAct.map((o) => `№${o.number}`).join(', ')}. Выдать можно, но лучше сначала оформить акт.
          </ErrorBox>
        )}
        <Field label="Кто выдаёт">
          <UserSelect value={who} onChange={(e) => setWho(e.target.value)} preferRoles={preferRolesFor(finalStage)} />
        </Field>
        <Checkbox
          checked={returned}
          onChange={(e) => setReturned(e.target.checked)}
          label="Техника возвращена клиентам (без этой отметки заявки не закрыть)"
        />
      </div>
    </Sheet>
  );
}
