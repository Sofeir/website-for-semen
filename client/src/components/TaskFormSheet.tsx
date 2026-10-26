import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inspectionKindOf, taskSchema, type TaskDetail, type TaskInput } from '@sd/shared';
import { useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useClientDevices, useInvalidate, useSettings, useTaskKinds } from '@/api/queries';
import { defaultDueDate, startForDue } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Select, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { DueInput, UserSelect } from './Pickers';
import { ChecklistEditor } from './ChecklistEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  task?: TaskDetail;
  orderId?: number;
  clientId?: number;
  presetTitle?: string;
  /** Выезд к клиенту — задача попадёт в раздел «Выезды». */
  visit?: boolean;
}

/** Создание и правка задачи. Рабочее время ограничено настройкой (по умолчанию до 19:00). */
export function TaskFormSheet({ open, onClose, task, orderId, clientId, presetTitle, visit }: Props) {
  const [checklist, setChecklist] = useState<string[]>([]);
  const clientDevices = useClientDevices(open && visit && !task ? (clientId ?? null) : null);
  const visitPlaces = useMemo(() => {
    const m = new Map<string, { pc: number; printer: number }>();
    for (const d of clientDevices.data ?? []) {
      const kind = inspectionKindOf(d.deviceType);
      if (!kind) continue;
      const key = d.location?.trim() || 'Без отдела';
      const row = m.get(key) ?? { pc: 0, printer: 0 };
      row[kind]++;
      m.set(key, row);
    }
    return [...m.entries()];
  }, [clientDevices.data]);
  const me = useMe();
  const settings = useSettings();
  const inv = useInvalidate();
  const toast = useToast();
  const kinds = useTaskKinds();
  const form = useForm<TaskInput>({ resolver: zodResolver(taskSchema) as any });

  useEffect(() => {
    if (!open) return;
    setChecklist([]);
    form.reset(
      task
        ? {
            title: task.title,
            description: task.description ?? '',
            assigneeId: task.assigneeId,
            orderId: task.orderId,
            clientId: task.clientId,
            startAt: task.startAt,
            dueAt: task.dueAt,
            deadlineAt: task.deadlineAt,
            kindId: task.kindId,
          }
        : {
            title: presetTitle ?? '',
            description: '',
            assigneeId: me.id,
            orderId: orderId ?? null,
            clientId: clientId ?? null,
            // срок по умолчанию — завтра; начало тогда — с начала рабочего дня, а для «сегодня» — с текущего момента
            startAt: startForDue(settings.data?.work, defaultDueDate(settings.data?.work)).toISOString(),
            dueAt: defaultDueDate(settings.data?.work).toISOString(),
            deadlineAt: null,
            kindId: null,
          },
    );
  }, [open, task, orderId, clientId, presetTitle, me.id, settings.data?.work, form]);

  const errors = form.formState.errors;
  const rootError = (errors.root?.message as string) || '';

  const submit = form.handleSubmit(async (values) => {
    try {
      if (task) await api.put(`/tasks/${task.id}`, values as any);
      else await api.post('/tasks', { ...values, visit, checklist: checklist.map((x) => x.trim()).filter(Boolean) } as any);
      inv('tasks', 'task', 'dashboard', 'order', 'client', 'visits');
      toast.success(task ? 'Задача сохранена' : 'Задача поставлена');
      onClose();
    } catch (e) {
      const err = e as ApiError;
      Object.entries(err.fields ?? {}).forEach(([k, v]) => form.setError(k as any, { message: v }));
      form.setError('root', { message: err.message });
    }
  });

  const workStart = settings.data?.work.workStart ?? '10:00';
  const workEnd = settings.data?.work.workEnd ?? '19:00';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={task ? 'Изменить задачу' : 'Новая задача'}
      full
      width={620}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            {task ? 'Сохранить' : 'Поставить задачу'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="stack" noValidate>
        {rootError && <ErrorBox>{rootError}</ErrorBox>}
        <Field label="Что сделать" error={errors.title?.message}>
          <Input {...form.register('title')} data-autofocus autoComplete="off" enterKeyHint="next" />
        </Field>
        <Field label="Вид задачи" optional hint="Если не выбрать, подберётся сам: техника, выезд или общая">
          <Select {...form.register('kindId')}>
            <option value="">Подобрать сам</option>
            {(kinds.data ?? [])
              .filter((k) => k.isActive || k.id === task?.kindId)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Ответственный" error={errors.assigneeId?.message}>
          <UserSelect {...form.register('assigneeId')} disabled={Boolean(task)} />
        </Field>
        <div className={formStyles.grid2}>
          <Field
            label="Срок"
            error={errors.dueAt?.message}
            hint={`Рабочий день с ${workStart} до ${workEnd}`}
            className={formStyles.span2}
          >
            <Controller
              control={form.control}
              name="dueAt"
              render={({ field }) => (
                <DueInput
                  value={field.value}
                  onChange={field.onChange}
                  onPreset={(start) => form.setValue('startAt', start, { shouldDirty: true, shouldValidate: true })}
                />
              )}
            />
          </Field>
          <Field label="Начало" error={errors.startAt?.message}>
            <Controller
              control={form.control}
              name="startAt"
              render={({ field }) => (
                <Input
                  type="datetime-local"
                  value={field.value ? toLocal(field.value) : ''}
                  onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value).toISOString() : '')}
                />
              )}
            />
          </Field>
          <Field label="Крайний срок" optional error={errors.deadlineAt?.message}>
            <Controller
              control={form.control}
              name="deadlineAt"
              render={({ field }) => (
                <Input
                  type="datetime-local"
                  value={field.value ? toLocal(field.value) : ''}
                  onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
                />
              )}
            />
          </Field>
        </div>
        <Field label="Подробности" optional error={errors.description?.message}>
          <Textarea {...form.register('description')} rows={4} />
        </Field>
        {!task && visit && (
          <Field label="Техника для проверки" group hint="Список появится в задаче. У каждого компьютера и принтера свой бланк, к любому пункту можно оставить комментарий.">
            {visitPlaces.length ? (
              <ul className="stack" style={{ margin: 0, paddingLeft: '1.2em', gap: 4 }}>
                {visitPlaces.map(([place, n]) => (
                  <li key={place}>
                    <b>{place}</b>: {[n.pc && `ПК ${n.pc}`, n.printer && `МФУ ${n.printer}`].filter(Boolean).join(', ')}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">У клиента пока нет компьютеров и принтеров. Добавьте их в карточке клиента на вкладке «Выезд».</span>
            )}
          </Field>
        )}
        {!task && !visit && (
          <Field label="Чек-лист" optional group hint="Пункты, которые исполнитель отметит по ходу работы">
            <ChecklistEditor items={checklist} onChange={setChecklist} />
          </Field>
        )}
      </form>
    </Sheet>
  );
}

function toLocal(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
