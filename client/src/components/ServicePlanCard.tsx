import { useEffect, useState } from 'react';
import { CalendarClock, Save, Trash2 } from 'lucide-react';
import type { ServicePlan } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useInvalidate, useServicePlan } from '@/api/queries';
import { fmtDay } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Card, CardHead, Pill } from '@/ui/Display';
import { Checkbox, Field, Input, Select, formStyles } from '@/ui/Form';
import { useConfirm } from '@/ui/Confirm';
import { useToast } from '@/ui/Toast';
import { UserSelect } from './Pickers';
import s from './ServicePlanCard.module.css';

/** Частоты, которые выбирают чаще всего. Значение — «N:unit». */
const PERIODS: { value: string; label: string }[] = [
  { value: '1:week', label: 'Каждую неделю' },
  { value: '2:week', label: 'Раз в 2 недели' },
  { value: '1:month', label: 'Раз в месяц' },
  { value: '2:month', label: 'Раз в 2 месяца' },
  { value: '3:month', label: 'Раз в квартал' },
  { value: '6:month', label: 'Раз в полгода' },
];

export function periodLabel(everyN: number, unit: 'week' | 'month') {
  return PERIODS.find((p) => p.value === `${everyN}:${unit}`)?.label ?? `Раз в ${everyN} ${unit === 'week' ? 'нед.' : 'мес.'}`;
}

const toDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const tomorrowYmd = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Draft {
  period: string;
  nextDate: string;
  visitTime: string;
  assigneeId: string;
  isActive: boolean;
}

const fromPlan = (p: ServicePlan | null): Draft =>
  p
    ? {
        period: `${p.everyN}:${p.unit}`,
        nextDate: p.nextDate,
        visitTime: p.visitTime ?? '',
        assigneeId: String(p.assigneeId),
        isActive: p.isActive,
      }
    : { period: '1:month', nextDate: tomorrowYmd(), visitTime: '', assigneeId: '', isActive: true };

/** График регулярных выездов к клиенту: накануне выезда задача с чек-листом ставится сама. */
export function ServicePlanCard({ clientId, bare, onSaved }: { clientId: number; bare?: boolean; onSaved?: () => void }) {
  const Wrap = bare ? 'div' : Card;
  const { can } = useAuth();
  const q = useServicePlan(clientId);
  const plan = q.data?.plan ?? null;
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<Draft>(() => fromPlan(null));
  const [saving, setSaving] = useState(false);
  const edit = can('clients.edit');

  useEffect(() => {
    if (q.data) setD(fromPlan(q.data.plan));
  }, [q.data]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const periods = PERIODS.some((p) => p.value === d.period)
    ? PERIODS
    : [...PERIODS, { value: d.period, label: periodLabel(Number(d.period.split(':')[0]), d.period.split(':')[1] as 'week') }];

  const save = async () => {
    if (!d.assigneeId) {
      toast.error('Выберите, кто едет');
      return;
    }
    const [n, unit] = d.period.split(':');
    setSaving(true);
    try {
      await api.put(`/clients/${clientId}/service-plan`, {
        everyN: Number(n),
        unit,
        nextDate: d.nextDate,
        visitTime: d.visitTime || null,
        assigneeId: Number(d.assigneeId),
        isActive: d.isActive,
      });
      toast.success('График сохранён');
      onSaved?.();
      inv('servicePlan', 'servicePlans', 'visits', 'tasks', 'dashboard', 'client');
    } catch (e) {
      toast.error('Не сохранилось', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: 'Удалить график выездов?',
        body: 'Уже поставленные задачи останутся.',
        confirm: 'Удалить',
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/clients/${clientId}/service-plan`);
      toast.success('График удалён');
      inv('servicePlan', 'servicePlans', 'visits');
    } catch (e) {
      toast.error('Не удалилось', (e as ApiError).message);
    }
  };

  return (
    <Wrap>
      <CardHead title="Регулярные выезды">
        {plan && (
          <Pill tone={plan.isActive ? 'teal' : 'outline'} dot={plan.isActive}>
            {plan.isActive ? 'по графику' : 'на паузе'}
          </Pill>
        )}
      </CardHead>
      <p className="muted" style={{ marginBottom: 'var(--s-4)' }}>
        Накануне выезда задача «Выезд» с чек-листом работ сама придёт тому, кто едет. После этого дата сдвигается на следующий
        раз.
      </p>
      {plan?.isActive && (
        <div className={s.next}>
          <CalendarClock aria-hidden />
          <span>
            Следующий выезд — <b>{fmtDay(toDate(plan.nextDate))}</b>
            {plan.visitTime ? ` в ${plan.visitTime}` : ''}, едет {plan.assigneeName}. {periodLabel(plan.everyN, plan.unit)}.
          </span>
        </div>
      )}
      <div className={formStyles.grid2}>
        <Field label="Как часто">
          <Select value={d.period} onChange={(e) => set('period', e.target.value)} disabled={!edit}>
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Кто едет">
          <UserSelect
            value={d.assigneeId}
            onChange={(e) => set('assigneeId', e.target.value)}
            preferRoles={['master', 'diagnostician']}
            disabled={!edit}
          />
        </Field>
        <Field label="Следующий выезд">
          <Input type="date" value={d.nextDate} onChange={(e) => set('nextDate', e.target.value)} disabled={!edit} />
        </Field>
        <Field label="Время" optional hint="Пусто — с начала рабочего дня">
          <Input type="time" value={d.visitTime} onChange={(e) => set('visitTime', e.target.value)} disabled={!edit} />
        </Field>
      </div>
      {edit && (
        <div className={s.actions}>
          <Checkbox label="Ездить по графику" checked={d.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          <div className={s.buttons}>
            {plan && (
              <Button variant="ghost" icon={<Trash2 size={16} aria-hidden />} onClick={remove}>
                Удалить
              </Button>
            )}
            <Button icon={<Save size={16} aria-hidden />} loading={saving} onClick={save}>
              Сохранить график
            </Button>
          </div>
        </div>
      )}
    </Wrap>
  );
}
