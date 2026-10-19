import { useState } from 'react';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { TASK_KIND_COLORS } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate, useTaskKinds } from '@/api/queries';
import { Button, cx } from '@/ui/Button';
import { ErrorBox, Pill } from '@/ui/Display';
import { Field, Input } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './KindsSheet.module.css';

/** Виды задач: список и добавление нового. Виды нельзя удалить, только скрыть, чтобы не терять старые задачи. */
export function KindsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const kinds = useTaskKinds();
  const inv = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('blue');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setError('');
    if (name.trim().length < 2) return setError('Назовите вид задач');
    setBusy(true);
    try {
      await api.post('/task-kinds', { name: name.trim(), color });
      inv('tasks', 'taskKinds');
      toast.success('Вид добавлен');
      setName('');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (k: { id: number; name: string; color: string; isActive: boolean }) => {
    try {
      await api.put(`/task-kinds/${k.id}`, { name: k.name, color: k.color, isActive: !k.isActive });
      inv('tasks', 'taskKinds');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Виды задач"
      subtitle="По видам можно фильтровать календарь и список задач"
      width={520}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="stack">
        <ul className={s.list}>
          {(kinds.data ?? []).map((k) => (
            <li key={k.id} className={cx(s.item, !k.isActive && s.off)}>
              <Pill tone={k.color} dot>
                {k.name}
              </Pill>
              <Button
                variant="ghost"
                size="sm"
                icon={k.isActive ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                onClick={() => toggle(k)}
              >
                {k.isActive ? 'Скрыть' : 'Показать'}
              </Button>
            </li>
          ))}
        </ul>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Новый вид" hint="Например: совещания, программы, встречи">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus />
        </Field>
        <div className={s.colors} role="radiogroup" aria-label="Цвет">
          {TASK_KIND_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className={cx(s.swatch, s[c], color === c && s.picked)}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <Button onClick={add} loading={busy} icon={<Plus size={18} aria-hidden />}>
          Добавить вид
        </Button>
      </div>
    </Sheet>
  );
}
