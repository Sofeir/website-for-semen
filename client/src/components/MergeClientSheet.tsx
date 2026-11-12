import { useEffect, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { ClientPickSheet, type PickedClient } from './ClientPickSheet';

interface Plan {
  from: { id: number; name: string };
  to: { id: number; name: string };
  moves: Record<string, number>;
  contacts: number;
  contactsSame: number;
  fleetRows: number;
  fleetSame: number;
  servicePlan: 'move' | 'skip' | 'none';
}

const LABELS: [string, string][] = [
  ['orders', 'заявки'],
  ['devices', 'единицы техники'],
  ['device_works', 'записи журнала работ'],
  ['tasks', 'задачи'],
  ['device_inspections', 'проверки техники на выездах'],
  ['intake_batches', 'приёмы'],
  ['attachments', 'файлы и фото'],
  ['service_checklist_items', 'пункты чек-листа выезда'],
  ['users', 'личные кабинеты заказчика'],
];

/**
 * Перенос всего от одной организации к другой: заявки, техника, журнал работ, выезды, задачи, люди, парк, график.
 * Номера заявок и актов не меняются. Старая организация остаётся пустой, её удаляют потом сами.
 */
export function MergeClientSheet({ open, onClose, from }: { open: boolean; onClose: () => void; from: { id: number; name: string } }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [pick, setPick] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPlan(null);
      setError('');
      setPick(true);
    }
  }, [open]);

  const choose = async (c: PickedClient) => {
    setPick(false);
    setError('');
    try {
      setPlan(await api.post<Plan>(`/clients/${from.id}/merge`, { targetId: c.id }));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/clients/${from.id}/merge`, { targetId: plan.to.id, apply: true });
      inv('clients', 'client', 'orders', 'order', 'tasks', 'dashboard', 'report');
      toast.success('Всё перенесено', `Теперь это в «${plan.to.name}». «${from.name}» осталась пустой: удалите её, когда проверите.`);
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const total = plan ? Object.values(plan.moves).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <ClientPickSheet
        open={pick}
        onClose={() => {
          setPick(false);
          if (!plan) onClose();
        }}
        onPick={choose}
        title={`Куда перенести «${from.name}»`}
      />
      <Sheet
        open={open && !pick && (Boolean(plan) || Boolean(error))}
        onClose={onClose}
        title="Перенести всё в другую организацию"
        subtitle={plan ? `«${plan.from.name}» → «${plan.to.name}»` : undefined}
        width={560}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            {plan && (
              <Button icon={<GitMerge size={18} aria-hidden />} loading={busy} onClick={apply}>
                Перенести
              </Button>
            )}
          </>
        }
      >
        <div className="stack">
          {error && <ErrorBox>{error}</ErrorBox>}
          {plan && (
            <>
              <p>
                Всё, что относится к «{plan.from.name}», станет относиться к «{plan.to.name}». Номера заявок, актов и квитанций не меняются.
                Если что-то пойдёт не так, ничего не изменится.
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                {LABELS.filter(([k]) => plan.moves[k] > 0).map(([k, label]) => (
                  <li key={k}>
                    {label}: <b>{plan.moves[k]}</b>
                  </li>
                ))}
                {plan.contacts - plan.contactsSame > 0 && (
                  <li>
                    люди организации: <b>{plan.contacts - plan.contactsSame}</b>
                  </li>
                )}
                {plan.fleetRows - plan.fleetSame > 0 && (
                  <li>
                    строки парка техники: <b>{plan.fleetRows - plan.fleetSame}</b>
                  </li>
                )}
                {plan.servicePlan === 'move' && <li>график выездов</li>}
                {total === 0 && <li>переносить нечего</li>}
              </ul>
              {(plan.contactsSame > 0 || plan.fleetSame > 0 || plan.servicePlan === 'skip') && (
                <p className="muted">
                  Остаётся у старой организации (у «{plan.to.name}» уже есть то же самое):
                  {plan.contactsSame > 0 && ` людей с теми же ФИО: ${plan.contactsSame} (их заявки привязаны к уже существующим);`}
                  {plan.fleetSame > 0 && ` строк парка с теми же отделами: ${plan.fleetSame};`}
                  {plan.servicePlan === 'skip' && ' график выездов (у новой свой).'}
                </p>
              )}
              <p className="muted">«{plan.from.name}» не удаляется: проверьте результат и удалите её сами.</p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
