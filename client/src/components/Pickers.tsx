import { forwardRef, useState, type SelectHTMLAttributes } from 'react';
import { ROLE_LABELS, STAFF_ROLES, type Role } from '@sd/shared';
import { useSettings, useUsers } from '@/api/queries';
import { defaultDueDate, fromLocalInput, sameDay, startForDue, toLocalInput } from '@/lib/dates';
import { cx } from '@/ui/Button';
import { Input, Select } from '@/ui/Form';
import s from './Pickers.module.css';

/** Выбор сотрудника, сгруппированный по ролям. preferRoles поднимает нужные роли наверх. */
export const UserSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { preferRoles?: Role[]; placeholder?: string }
>(function UserSelect({ preferRoles, placeholder = 'Выберите сотрудника', ...rest }, ref) {
  const users = useUsers();
  const active = (users.data ?? []).filter((u) => u.isActive !== false);
  const order = [...(preferRoles ?? []), ...STAFF_ROLES.filter((r) => !preferRoles?.includes(r))];
  return (
    <Select ref={ref} {...rest}>
      <option value="">{users.isLoading ? 'Загружаем…' : placeholder}</option>
      {order.map((role) => {
        const list = active.filter((u) => u.role === role);
        if (!list.length) return null;
        return (
          <optgroup key={role} label={ROLE_LABELS[role]}>
            {list.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </optgroup>
        );
      })}
    </Select>
  );
});

/**
 * Срок: быстрые варианты чипами + точное время.
 * Значение — ISO-строка. Рабочий день заканчивается в workEnd из настроек.
 */
export function DueInput({
  value,
  onChange,
  onPreset,
  id,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (iso: string) => void;
  /** Быстрый выбор: вместе со сроком подставить и начало работы. */
  onPreset?: (startIso: string, dueIso: string) => void;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const settings = useSettings();
  const ws = settings.data?.work;
  const presets = [
    { label: 'Сегодня', date: defaultDueDate(ws, 0) },
    { label: 'Завтра', date: defaultDueDate(ws, 1) },
    { label: 'Послезавтра', date: defaultDueDate(ws, 2) },
  ];
  const current = value ? new Date(value) : null;
  /**
   * В выходной и после конца рабочего дня «сегодня» и «завтра» попадают на один рабочий день и дают одну дату.
   * Поэтому подсвечиваем ту кнопку, которую нажали, а не все с совпавшей датой.
   */
  const [picked, setPicked] = useState<number | null>(null);
  const matches = presets.map((p) => Boolean(current && sameDay(current, p.date) && current.getHours() === p.date.getHours()));
  const onIndex = picked !== null && matches[picked] ? picked : matches.indexOf(true);
  return (
    <div className={s.due}>
      <div className={s.presets} role="group" aria-label="Быстрый выбор срока">
        {presets.map((p, i) => {
          const on = i === onIndex;
          return (
            <button
              key={p.label}
              type="button"
              className={cx(s.preset, on && s.presetOn)}
              aria-pressed={on}
              onClick={() => {
                setPicked(i);
                onChange(p.date.toISOString());
                onPreset?.(startForDue(ws, p.date).toISOString(), p.date.toISOString());
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <Input
        id={id}
        type="datetime-local"
        value={toLocalInput(value)}
        onChange={(e) => onChange(fromLocalInput(e.target.value))}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        step={900}
      />
    </div>
  );
}
