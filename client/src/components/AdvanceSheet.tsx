import { useEffect, useState } from 'react';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import type { Stage } from '@sd/shared';
import { useMe } from '@/app/auth';
import { ApiError } from '@/api/http';
import { useAdvanceOrder, useReassignOrder, useSettings, useUsers } from '@/api/queries';
import { defaultDueDate } from '@/lib/dates';
import { dueDaysFor, preferRolesFor } from '@/lib/stages';
import { Button } from '@/ui/Button';
import { ErrorBox, StagePill } from '@/ui/Display';
import { Field, Input, Textarea } from '@/ui/Form';
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
  }, [order, next, users.data, settings.data?.work, me.id, me.role]);

  const submit = async () => {
    setError('');
    if (!responsible) return setError('Выберите ответственного');
    try {
      await advance.mutateAsync({
        toStageId: next!.id,
        responsibleId: Number(responsible),
        dueAt: next!.isFinal ? null : due,
        comment: comment || null,
        estimatedCost: cost ? Number(cost.replace(',', '.')) : null,
      });
      toast.success(next!.isFinal ? `Заявка №${order!.number} выдана` : `Заявка №${order!.number}: ${next!.name}`);
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
      title={next?.isFinal ? 'Выдать технику' : `Перевести на «${next?.name ?? ''}»`}
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
            variant={next?.isFinal ? 'success' : 'primary'}
          >
            {next?.isFinal ? 'Выдать' : 'Перевести'}
          </Button>
        </>
      }
    >
      {order && next && (
        <div className="stack">
          <div className="row wrap" aria-label="Переход этапа">
            <StagePill name={order.stageName} color={order.stageColor} />
            <ArrowRight size={16} aria-hidden className="muted" />
            <StagePill name={next.name} color={next.color} />
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {next.isFinal && order.hasAct === false && (
            <ErrorBox>Акта выполненных работ ещё нет. Выдать можно, но лучше сначала оформить акт.</ErrorBox>
          )}
          <Field label={next.isFinal ? 'Кто выдаёт' : 'Ответственный'}>
            <UserSelect value={responsible} onChange={(e) => setResponsible(e.target.value)} preferRoles={preferRolesFor(next)} />
          </Field>
          {!next.isFinal && (
            <Field label="Срок" hint={`Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}>
              <DueInput value={due} onChange={setDue} />
            </Field>
          )}
          {showCost && (
            <Field label="Примерная стоимость, ₽" optional>
              <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Например, 3500" />
            </Field>
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
    try {
      await reassign.mutateAsync({ responsibleId: Number(responsible), dueAt: due, comment: comment || null });
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
        <Field label="Комментарий" optional>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Например: нужна замена разъёма, это к мастеру"
          />
        </Field>
      </div>
    </Sheet>
  );
}
