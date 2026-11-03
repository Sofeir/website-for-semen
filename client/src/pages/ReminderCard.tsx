import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus, RotateCcw, X } from 'lucide-react';
import { pluralRu, type ReminderSettings } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useReminders } from '@/api/queries';
import { Button, IconButton } from '@/ui/Button';
import { Card, CardHead, ErrorBox, Spinner } from '@/ui/Display';
import { Input, Select } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import s from './ReminderCard.module.css';

const UNITS = [
  { value: 1, label: 'минут' },
  { value: 60, label: 'часов' },
  { value: 1440, label: 'дней' },
];

/** «1440» → «1 день», «120» → «2 часа», «15» → «15 минут». */
export function reminderText(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${pluralRu(d, 'день', 'дня', 'дней')}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${pluralRu(h, 'час', 'часа', 'часов')}`;
  }
  return `${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')}`;
}

/**
 * Свои напоминания: за сколько до крайнего срока задачи и до начала события прислать уведомление.
 * Их можно добавить сколько угодно, например каждые 10 минут перед сроком.
 */
export function ReminderCard() {
  const q = useReminders();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (minutes: number[]) => {
    setBusy(true);
    setError('');
    try {
      const next = await api.put<ReminderSettings>('/me/reminders', { minutes });
      qc.setQueryData(['reminders'], next);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const minutes = Math.round(Number(amount.replace(',', '.')) * unit);
    if (!Number.isFinite(minutes) || minutes < 1) return setError('Введите, за сколько напомнить');
    if (minutes > 43200) return setError('Не больше 30 дней');
    if (q.data?.minutes.includes(minutes)) return setError('Такое напоминание уже есть');
    void save([...(q.data?.minutes ?? []), minutes]);
  };

  const reset = async () => {
    setBusy(true);
    try {
      qc.setQueryData(['reminders'], await api.del<ReminderSettings>('/me/reminders'));
      toast.success('Вернули стандартные напоминания');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="Напоминания о сроках" />
      <div className="stack">
        <p className="muted">
          За сколько напомнить о крайнем сроке задачи и о начале события в календаре. Добавьте столько напоминаний, сколько нужно.
        </p>
        {error && <ErrorBox>{error}</ErrorBox>}
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorBox error={q.error} />
        ) : (
          <>
            {q.data?.minutes.length ? (
              <ul className={s.list}>
                {q.data.minutes.map((m) => (
                  <li key={m} className={s.item}>
                    <BellRing size={16} aria-hidden />
                    <span>за {reminderText(m)}</span>
                    <IconButton
                      label={`Убрать напоминание за ${reminderText(m)}`}
                      disabled={busy}
                      onClick={() => save(q.data!.minutes.filter((x) => x !== m))}
                    >
                      <X />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Напоминаний нет: уведомления придут только о просрочке.</p>
            )}
            <div className={s.add}>
              <span>Напомнить за</span>
              <Input
                className={s.amount}
                type="number"
                inputMode="decimal"
                min={1}
                aria-label="Сколько"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Select aria-label="Единица" value={unit} onChange={(e) => setUnit(Number(e.target.value))}>
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
              <Button size="sm" icon={<Plus size={16} aria-hidden />} loading={busy} onClick={add}>
                Добавить
              </Button>
            </div>
            {q.data?.custom && (
              <div>
                <Button variant="ghost" size="sm" icon={<RotateCcw size={16} aria-hidden />} disabled={busy} onClick={reset}>
                  Вернуть стандартные (сутки, 2 часа, 15 минут)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
