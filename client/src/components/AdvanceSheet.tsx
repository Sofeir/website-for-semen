import { useEffect, useState } from 'react';
import { ArrowRight, ArrowRightLeft, RotateCcw } from 'lucide-react';
import type { Stage } from '@sd/shared';
import { useMe } from '@/app/auth';
import { ApiError } from '@/api/http';
import { useAdvanceOrder, useDictionaries, useReassignOrder, useReopenOrder, useSettings, useUsers } from '@/api/queries';
import { defaultDueDate } from '@/lib/dates';
import { dueDaysFor, preferRolesFor } from '@/lib/stages';
import { Button } from '@/ui/Button';
import { ErrorBox, StagePill } from '@/ui/Display';
import { Checkbox, Field, Input, Segmented, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { DueInput, UserSelect } from './Pickers';

export interface AdvanceTarget {
  id: number;
  number: string;
  deviceTitle: string;
  stageName: string;
  stageColor: string;
  responsibleId: number | null;
  hasAct?: boolean;
}

/** Перевод заявки на следующий этап: ответственный, срок, комментарий. */
export function AdvanceSheet({
  order,
  next,
  onClose,
  onDone,
}: {
  order: AdvanceTarget | null;
  next: Stage | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const me = useMe();
  const users = useUsers();
  const settings = useSettings();
  const toast = useToast();
  const advance = useAdvanceOrder(order?.id ?? 0);
  const dict = useDictionaries();
  const [declined, setDeclined] = useState(false);
  const [returned, setReturned] = useState(false);
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const [comment, setComment] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!order || !next) return;
    const prefer = preferRolesFor(next);
    const list = users.data ?? [];
    // Себя, если подходит по роли; иначе первого подходящего сотрудника.
    const pick =
      (prefer.includes(me.role) && me.id) || list.find((u) => u.role === prefer[0] && u.isActive !== false)?.id || me.id;
    setResponsible(String(pick));
    setDue(defaultDueDate(settings.data?.work, dueDaysFor(next)).toISOString());
    setComment('');
    setCost('');
    setError('');
    setDeclined(false);
    setReturned(false);
  }, [order, next, users.data, settings.data?.work, me.id, me.role]);

  // Отказ без ремонта: из согласования сразу в «Готово», этап ремонта пропускаем.
  const canDecline = next?.code === 'repair';
  const stageList = (dict.data?.stages ?? []).filter((st) => st.isActive);
  const afterNext = next ? stageList[stageList.findIndex((st) => st.id === next.id) + 1] : undefined;
  const target = declined && canDecline && afterNext ? afterNext : next;

  const submit = async () => {
    setError('');
    if (!responsible) return setError('Выберите ответственного');
    if (target!.isFinal && !returned) return setError('Отметьте, что техника возвращена клиенту');
    try {
      await advance.mutateAsync({
        toStageId: target!.id,
        responsibleId: Number(responsible),
        dueAt: target!.isFinal ? null : due,
        comment: comment || null,
        estimatedCost: cost ? Number(cost.replace(',', '.')) : null,
        declined: declined && canDecline,
        deviceReturned: target!.isFinal ? returned : undefined,
      });
      toast.success(target!.isFinal ? `Заявка №${order!.number} выдана` : `Заявка №${order!.number}: ${target!.name}`);
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const showCost = next?.code === 'approval' || next?.code === 'repair';

  return (
    <Sheet
      open={Boolean(order && next)}
      onClose={onClose}
      title={target?.isFinal ? 'Выдать технику' : `Перевести на «${target?.name ?? ''}»`}
      subtitle={order && `№${order.number}, ${order.deviceTitle}`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            loading={advance.isPending}
            icon={<ArrowRight size={18} aria-hidden />}
            variant={target?.isFinal ? 'success' : 'primary'}
          >
            {target?.isFinal ? 'Выдать' : 'Перевести'}
          </Button>
        </>
      }
    >
      {order && next && (
        <div className="stack">
          <div className="row wrap" aria-label="Переход этапа">
            <StagePill name={order.stageName} color={order.stageColor} />
            <ArrowRight size={16} aria-hidden className="muted" />
            <StagePill name={target!.name} color={target!.color} />
          </div>
          {canDecline && (
            <Checkbox
              checked={declined}
              onChange={(e) => setDeclined(e.target.checked)}
              label="Клиент отказался от ремонта: вернуть без ремонта"
            />
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          {target!.isFinal && order.hasAct === false && (
            <ErrorBox>Акта выполненных работ ещё нет. Выдать можно, но лучше сначала оформить акт.</ErrorBox>
          )}
          <Field label={next.isFinal ? 'Кто выдаёт' : 'Ответственный'}>
            <UserSelect value={responsible} onChange={(e) => setResponsible(e.target.value)} preferRoles={preferRolesFor(next)} />
          </Field>
          {!target!.isFinal && (
            <Field label="Срок" hint={`Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}>
              <DueInput value={due} onChange={setDue} />
            </Field>
          )}
          {showCost && !declined && (
            <Field label="Примерная стоимость, ₽" optional>
              <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Например, 3500" />
            </Field>
          )}
          {target!.isFinal && (
            <Checkbox
              checked={returned}
              onChange={(e) => setReturned(e.target.checked)}
              label="Техника возвращена клиенту (без этой отметки заявку не закрыть)"
            />
          )}
          <Field label="Комментарий" optional hint="Увидит новый ответственный и постановщик прошлой задачи">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

/** Передача заявки другому сотруднику на том же этапе (диагност → мастер). */
export function ReassignSheet({ order, onClose }: { order: AdvanceTarget | null; onClose: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const reassign = useReassignOrder(order?.id ?? 0);
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!order) return;
    setResponsible('');
    setDue(defaultDueDate(settings.data?.work, 1).toISOString());
    setComment('');
    setError('');
  }, [order, settings.data?.work]);

  const submit = async () => {
    setError('');
    if (!responsible) return setError('Выберите, кому передать');
    if (comment.trim().length < 3) return setError('Напишите причину передачи и что уже сделано');
    try {
      await reassign.mutateAsync({ responsibleId: Number(responsible), dueAt: due, comment: comment.trim() });
      toast.success(`Заявка №${order!.number} передана`);
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  return (
    <Sheet
      open={Boolean(order)}
      onClose={onClose}
      title="Передать другому сотруднику"
      subtitle={order && `№${order.number}, этап «${order.stageName}» не меняется`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={reassign.isPending} icon={<ArrowRightLeft size={18} aria-hidden />}>
            Передать
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Кому">
          <UserSelect
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            preferRoles={['master', 'diagnostician']}
            data-autofocus
          />
        </Field>
        <Field label="Срок" hint={`Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}>
          <DueInput value={due} onChange={setDue} />
        </Field>
        <Field label="Причина передачи и что уже сделано" hint="Увидят постановщик и руководитель">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Например: заменил память, не хватило времени на тесты"
          />
        </Field>
      </div>
    </Sheet>
  );
}

/** Выданная техника вернулась: та же заявка открывается заново (гарантия или новая поломка). */
export function ReopenSheet({ order, onClose }: { order: AdvanceTarget | null; onClose: () => void }) {
  const me = useMe();
  const settings = useSettings();
  const toast = useToast();
  const reopen = useReopenOrder(order?.id ?? 0);
  const [reason, setReason] = useState<'warranty' | 'new_fault'>('warranty');
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!order) return;
    setReason('warranty');
    setResponsible(String(me.id));
    setDue(defaultDueDate(settings.data?.work, 1).toISOString());
    setComment('');
    setError('');
  }, [order, settings.data?.work, me.id]);

  const submit = async () => {
    setError('');
    if (!responsible) return setError('Выберите ответственного');
    try {
      await reopen.mutateAsync({ reason, responsibleId: Number(responsible), dueAt: due, comment: comment.trim() || null });
      toast.success(`Заявка №${order!.number} открыта заново`);
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  return (
    <Sheet
      open={Boolean(order)}
      onClose={onClose}
      title="Открыть заявку заново"
      subtitle={order && `№${order.number}, ${order.deviceTitle}. Вся история останется в этой заявке`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={reopen.isPending} icon={<RotateCcw size={18} aria-hidden />}>
            Открыть заново
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Что произошло" group>
          <Segmented<'warranty' | 'new_fault'>
            block
            label="Что произошло"
            layoutId="reopen-reason"
            value={reason}
            onChange={setReason}
            options={[
              { value: 'warranty', label: 'Гарантия' },
              { value: 'new_fault', label: 'Новая поломка' },
            ]}
          />
        </Field>
        <Field label="Ответственный на диагностике">
          <UserSelect value={responsible} onChange={(e) => setResponsible(e.target.value)} preferRoles={['diagnostician', 'master']} />
        </Field>
        <Field label="Срок" hint={`Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}>
          <DueInput value={due} onChange={setDue} />
        </Field>
        <Field label="Комментарий" optional>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} />
        </Field>
      </div>
    </Sheet>
  );
}
