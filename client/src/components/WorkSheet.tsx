import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { REFILL_OPS, REFILL_OP_LABELS, WORK_KINDS, WORK_KIND_LABELS, type RefillOp, type WorkKind } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useMe } from '@/app/auth';
import { useClient, useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { cx } from '@/ui/Button';
import { ChipGroup, Field, Input, Select, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { UserSelect } from './Pickers';
import s from './WorkSheet.module.css';

export interface WorkTarget {
  clientId: number;
  deviceId?: number | null;
  orderId?: number | null;
}

const num = (v: string) => (v.trim() ? Number(v.replace(/\s/g, '').replace(',', '.')) : null);

/**
 * Запись работы: кто делал, что сделано, сколько стоило. Для замены детали — бренд, параметры, гарантия,
 * пробег и расчётный ресурс; для заправки — что входило (заправка, барабан, ролик, чип, ракель).
 */
export function WorkSheet({
  open,
  onClose,
  target,
  kinds = [...WORK_KINDS],
  defaultKind,
  title: sheetTitle,
  subtitle,
  chooseOrder,
}: {
  open: boolean;
  onClose: () => void;
  target: WorkTarget;
  kinds?: WorkKind[];
  defaultKind?: WorkKind;
  title?: string;
  subtitle?: string;
  /** Спросить, по какой заявке сделана работа (когда её открыли из карточки клиента). */
  chooseOrder?: boolean;
}) {
  const me = useMe();
  const inv = useInvalidate();
  const toast = useToast();
  const first = defaultKind ?? kinds[0];
  const [kind, setKind] = useState<WorkKind>(first);
  const [what, setWhat] = useState('');
  const [performerId, setPerformerId] = useState(String(me.id));
  const [qty, setQty] = useState('1');
  const [amount, setAmount] = useState('');
  const [counter, setCounter] = useState('');
  const [resource, setResource] = useState('');
  const [brand, setBrand] = useState('');
  const [spec, setSpec] = useState('');
  const [warranty, setWarranty] = useState('');
  const [ops, setOps] = useState<RefillOp[]>(['refill']);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState('');
  const client = useClient(chooseOrder && open ? target.clientId : 0);
  const orders = client.data?.orders ?? [];

  useEffect(() => {
    if (!open) return;
    setKind(first);
    setWhat('');
    setPerformerId(String(me.id));
    setQty('1');
    setAmount('');
    setCounter('');
    setResource('');
    setBrand('');
    setSpec('');
    setWarranty('');
    setOps(['refill']);
    setNote('');
    setError('');
    setOrderId('');
  }, [open, first, me.id]);

  // По умолчанию берём последнюю заявку клиента, которая ещё в работе.
  useEffect(() => {
    if (!chooseOrder || !open || orderId) return;
    const active = orders.find((o) => !o.issuedAt) ?? orders[0];
    if (active) setOrderId(String(active.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chooseOrder, open, orders.length]);

  const save = async () => {
    setError('');
    if (what.trim().length < 2) return setError(kind === 'refill' ? 'Напишите модель картриджа' : 'Напишите, что сделано');
    if (!Number(performerId)) return setError('Выберите, кто делал');
    setBusy(true);
    try {
      await api.post('/works', {
        ...target,
        orderId: target.orderId ?? (Number(orderId) || null),
        kind,
        title: what.trim(),
        qty: Number(qty) || 1,
        performerId: Number(performerId),
        amount: num(amount),
        counter: kind === 'part' ? num(counter) : null,
        resource: kind === 'part' ? num(resource) : null,
        partBrand: kind === 'part' ? brand.trim() || null : null,
        partSpec: kind === 'part' ? spec.trim() || null : null,
        warrantyMonths: kind === 'part' ? num(warranty) : null,
        ops: kind === 'refill' ? ops : [],
        note: note.trim() || null,
      });
      inv('clients', 'client', 'orders', 'order', 'deviceWorks', 'clientWorks', 'report', 'analytics');
      toast.success(kind === 'refill' ? 'Заправка записана' : 'Работа записана');
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={sheetTitle ?? (kinds.length === 1 && kinds[0] === 'refill' ? 'Заправка картриджей' : 'Записать работу')}
      subtitle={subtitle}
      width={560}
      full
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} loading={busy} icon={<Plus size={18} aria-hidden />}>
            Записать
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        {kinds.length > 1 && (
          <div className={s.kinds} role="radiogroup" aria-label="Вид работы">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={cx(s.kind, kind === k && s.kindOn)}
                onClick={() => setKind(k)}
              >
                {WORK_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
        {chooseOrder && (
          <Field label="По какой заявке" hint="Заправка и замена записываются в заявку, по ней потом можно перейти из отчёта">
            <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Без заявки</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  №{o.number}, {o.deviceTitle}
                  {o.issuedAt ? ' (выдана)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className={formStyles.grid2}>
          <Field label={kind === 'refill' ? 'Модель картриджа' : 'Что сделано'} className={formStyles.span2}>
            <Input
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder={kind === 'refill' ? 'Например: CF259A' : kind === 'part' ? 'Например: оперативная память' : 'Например: чистка от пыли'}
              data-autofocus
              maxLength={200}
            />
          </Field>
          <Field label="Кто делал">
            <UserSelect value={performerId} onChange={(e) => setPerformerId(e.target.value)} />
          </Field>
          <Field label={kind === 'refill' ? 'Сколько картриджей' : 'Количество'}>
            <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Сумма, ₽" optional>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3500" />
          </Field>
        </div>

        {kind === 'refill' && (
          <Field label="Что входило в заправку" group hint="Отметьте всё, что сделали, например заправка и замена чипа">
            <ChipGroup
              label="Работы при заправке"
              options={REFILL_OPS.map((o) => REFILL_OP_LABELS[o])}
              value={ops.map((o) => REFILL_OP_LABELS[o])}
              onChange={(names) => setOps(REFILL_OPS.filter((o) => names.includes(REFILL_OP_LABELS[o])))}
            />
          </Field>
        )}

        {kind === 'part' && (
          <div className={formStyles.grid2}>
            <Field label="Бренд" optional>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Kingston" maxLength={100} />
            </Field>
            <Field label="Объём или модель" optional>
              <Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="8 ГБ DDR4" maxLength={100} />
            </Field>
            <Field label="Гарантия, мес." optional>
              <Input inputMode="numeric" value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="12" />
            </Field>
            <Field label="Пробег принтера, стр." optional hint="Счётчик на момент замены">
              <Input inputMode="numeric" value={counter} onChange={(e) => setCounter(e.target.value)} placeholder="80000" />
            </Field>
            <Field label="Ресурс детали, стр." optional hint="На сколько листов рассчитана" className={formStyles.span2}>
              <Input inputMode="numeric" value={resource} onChange={(e) => setResource(e.target.value)} placeholder="150000" />
            </Field>
          </div>
        )}

        <Field label="Заметка" optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
      </div>
    </Sheet>
  );
}
