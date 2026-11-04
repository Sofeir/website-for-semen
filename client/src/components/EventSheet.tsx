import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CalendarEvent } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { useConfirm } from '@/ui/Confirm';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';

const p2 = (n: number) => String(n).padStart(2, '0');
const toLocal = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

/**
 * Личное событие в календаре: название и время начала. Видно только вам, никому не назначается и конца не имеет.
 * Напоминания приходят по настройкам из профиля.
 */
export function EventSheet({
  open,
  onClose,
  event,
  startAt,
}: {
  open: boolean;
  onClose: () => void;
  event?: CalendarEvent | null;
  /** Время начала для нового события. */
  startAt?: Date;
}) {
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [start, setStart] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setTitle(event?.title ?? '');
    setNote(event?.note ?? '');
    setStart(toLocal(event ? new Date(event.startAt) : (startAt ?? new Date())));
  }, [open, event, startAt]);

  const save = async () => {
    setError('');
    if (title.trim().length < 2) return setError('Назовите событие');
    if (!start) return setError('Укажите время начала');
    setBusy(true);
    try {
      const body = { title: title.trim(), note: note.trim(), startAt: new Date(start).toISOString() };
      if (event) await api.put(`/calendar-events/${event.id}`, body);
      else await api.post('/calendar-events', body);
      await inv('events');
      toast.success(event ? 'Событие сохранено' : 'Событие добавлено');
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event || !(await confirm({ title: 'Удалить событие?', body: event.title, confirm: 'Удалить', danger: true }))) return;
    try {
      await api.del(`/calendar-events/${event.id}`);
      await inv('events');
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={event ? 'Событие' : 'Новое событие'}
      subtitle="Только для вас: видите его вы, никому оно не назначается"
      width={480}
      footer={
        <>
          {event && (
            <Button variant="ghost" icon={<Trash2 size={18} aria-hidden />} onClick={remove}>
              Удалить
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={busy} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Что планируете">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus autoComplete="off" maxLength={200} placeholder="Например: совещание" />
        </Field>
        <Field label="Начало" hint="Напомним заранее: сутки, 2 часа, 15 минут. Это можно изменить в профиле">
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Заметка" optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
        </Field>
      </form>
    </Sheet>
  );
}
