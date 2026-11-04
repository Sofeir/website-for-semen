import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus, RotateCcw, X } from 'lucide-react';
import { pluralRu, type ReminderSettings } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useReminders } from '@/api/queries';
import { Button, IconButton } from '@/ui/Button';
import { NumberWheelField } from '@/ui/DateTimeInput';
import { Card, CardHead, ErrorBox, Spinner } from '@/ui/Display';
import { Select } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import s from './ReminderCard.module.css';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
/** Единицы и какие числа в них можно выбрать: минуты 1–59, часы 1–23, дни 1–30. */
const UNITS = [
  { value: 1, label: 'минут', items: range(59) },
  { value: 60, label: 'часов', items: range(23) },
  { value: 1440, label: 'дней', items: range(30) },
];

/** «1440» → «1 день», «150» → «2 часа 30 минут», «15» → «15 минут». */
export function reminderText(total: number): string {
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return [
    d && `${d} ${pluralRu(d, 'день', 'дня', 'дней')}`,
    h && `${h} ${pluralRu(h, 'час', 'часа', 'часов')}`,
    m && `${m} ${pluralRu(m, 'минуту', 'минуты', 'минут')}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Свои напоминания: за сколько до крайнего срока задачи и до начала события прислать уведомление.
 * Время выбирается колёсами (дни, часы, минуты), как во времени задачи; напоминаний можно добавить сколько угодно.
 */
export function ReminderCard() {
  const q = useReminders();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(30);
  const [unit, setUnit] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const items = UNITS.find((u) => u.value === unit)!.items;
  const total = amount * unit;

  const save = async (list: number[]) => {
    setBusy(true);
    setError('');
    try {
      const next = await api.put<ReminderSettings>('/me/reminders', { minutes: list });
      qc.setQueryData(['reminders'], next);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (total > 43200) return setError('Не больше 30 дней');
    if (q.data?.minutes.includes(total)) return setError('Такое напоминание уже есть');
    void save([...(q.data?.minutes ?? []), total]);
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
              <NumberWheelField label="Сколько" value={amount} items={items} onChange={setAmount} />
              <Select
                aria-label="Единица"
                value={unit}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setUnit(next);
                  const max = UNITS.find((u) => u.value === next)!.items.length;
                  setAmount((a) => Math.min(a, max));
                }}
              >
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
