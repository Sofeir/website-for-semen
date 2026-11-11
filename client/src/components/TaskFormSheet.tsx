import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inspectionKindOf, taskSchema, type Attachment, type TaskDetail, type TaskInput } from '@sd/shared';
import { useAuth, useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useClientDevices, useInvalidate, useSettings, useTaskKinds } from '@/api/queries';
import { defaultDueDate, fmtWhen, startForDue } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Segmented, Select, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { DueInput, UserMultiSelect } from './Pickers';
import { ChecklistEditor } from './ChecklistEditor';
import { AttachHint, AttachmentList, UploadButton } from './Attachments';

interface Props {
  open: boolean;
  onClose: () => void;
  task?: TaskDetail;
  orderId?: number;
  clientId?: number;
  presetTitle?: string;
  /** Выезд к клиенту — задача попадёт в раздел «Выезды». */
  visit?: boolean;
  /** С чего начать: выезд к клиенту или удалённое обслуживание. */
  visitMode?: 'onsite' | 'remote';
}

const VISIT_PREFIX = { onsite: 'Выезд: ', remote: 'Удалённое обслуживание: ' } as const;

/** Создание и правка задачи. Рабочее время ограничено настройкой (по умолчанию до 19:00). */
export function TaskFormSheet({ open, onClose, task, orderId, clientId, presetTitle, visit, visitMode }: Props) {
  const [mode, setMode] = useState<'onsite' | 'remote'>(visitMode ?? 'onsite');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
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
  const { can } = useAuth();
  const settings = useSettings();
  const inv = useInvalidate();
  const toast = useToast();
  const kinds = useTaskKinds();
  const form = useForm<TaskInput>({ resolver: zodResolver(taskSchema) as any });

  useEffect(() => {
    if (!open) return;
    setChecklist([]);
    setFiles([]);
    setMode(visitMode ?? 'onsite');
    form.reset(
      task
        ? {
            title: task.title,
            description: task.description ?? '',
            assigneeIds: task.assigneeIds,
            watcherIds: task.watcherIds,
            orderId: task.orderId,
            clientId: task.clientId,
            startAt: task.startAt,
            dueAt: task.dueAt,
            kindId: task.kindId,
          }
        : {
            title: presetTitle ?? '',
            description: '',
            assigneeIds: [me.id],
            watcherIds: [],
            orderId: orderId ?? null,
            clientId: clientId ?? null,
            // срок по умолчанию — завтра; начало тогда — с начала рабочего дня, а для «сегодня» — с текущего момента
            startAt: startForDue(settings.data?.work, defaultDueDate(settings.data?.work)).toISOString(),
            dueAt: defaultDueDate(settings.data?.work).toISOString(),
            kindId: null,
          },
    );
  }, [open, task, orderId, clientId, presetTitle, visitMode, me.id, settings.data?.work, form]);

  const errors = form.formState.errors;
  const rootError = (errors.root?.message as string) || '';

  const submit = form.handleSubmit(async (values) => {
    if (task && extending && (values.dueReason ?? '').trim().length < 3) {
      form.setError('dueReason', { message: 'Напишите причину продления срока' });
      return;
    }
    try {
      if (task) await api.put(`/tasks/${task.id}`, { ...values, dueReason: extending ? values.dueReason : null } as any);
      else {
        await api.post('/tasks', {
          ...values,
          visit,
          visitMode: visit ? mode : undefined,
          checklist: checklist.map((x) => x.trim()).filter(Boolean),
          attachmentIds: files.map((a) => a.id),
        } as any);
      }
      inv('tasks', 'task', 'dashboard', 'order', 'client', 'visits');
      toast.success(task ? 'Задача сохранена' : 'Задача поставлена');
      onClose();
    } catch (e) {
      const err = e as ApiError;
      Object.entries(err.fields ?? {}).forEach(([k, v]) => form.setError(k as any, { message: v }));
      form.setError('root', { message: err.message });
    }
  });

  // Срок действующей задачи двигает любой сотрудник, пока она не просрочена; просроченной — только тот, кто подтверждает просрочку (директор)
  const lockedDue = Boolean(task && task.overdue && !me.confirmsOverdue);
  // Отодвинуть срок может не только директор — тогда нужна причина, она остаётся в цепочке задачи
  const watchedDue = form.watch('dueAt');
  const extending = Boolean(task && !me.confirmsOverdue && watchedDue && new Date(watchedDue).getTime() > new Date(task.dueAt).getTime() + 60_000);
  // Ответственных у действующей задачи меняет постановщик или руководитель; исполнитель передаёт задачу
  const lockedAssignees = Boolean(task && task.creatorId !== me.id && !can('tasks.manageAll'));
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
        {visit && !task && (
          <Field label="Как проводим" group>
            <Segmented<'onsite' | 'remote'>
              label="Как проводим"
              layoutId="visit-mode"
              value={mode}
              onChange={(next) => {
                // заголовок с прежней приставкой переписываем на новую, остальное в нём не трогаем
                const title = form.getValues('title') ?? '';
                const old = VISIT_PREFIX[mode];
                if (title.startsWith(old)) form.setValue('title', VISIT_PREFIX[next] + title.slice(old.length));
                setMode(next);
              }}
              options={[
                { value: 'onsite', label: 'Выезд к клиенту' },
                { value: 'remote', label: 'Удалённо' },
              ]}
            />
          </Field>
        )}
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
        <Field
          label="Ответственные"
          error={errors.assigneeIds?.message as string | undefined}
          hint={lockedAssignees ? 'Чтобы сменить ответственных, передайте задачу' : 'Отметьте одного или нескольких сотрудников: уведомления придут всем'}
          group
        >
          <Controller
            control={form.control}
            name="assigneeIds"
            render={({ field }) => (
              <UserMultiSelect value={field.value ?? []} onChange={field.onChange} disabled={lockedAssignees} />
            )}
          />
        </Field>
        <Field
          label="Наблюдатели"
          optional
          hint="Видят задачу и получают уведомления о ней, но не исполняют и не закрывают её"
          group
        >
          <Controller
            control={form.control}
            name="watcherIds"
            render={({ field }) => (
              <UserMultiSelect
                value={field.value ?? []}
                onChange={field.onChange}
                label="Наблюдатели"
              />
            )}
          />
        </Field>
        <div className={formStyles.grid2}>
          <Field
            label="Крайний срок"
            error={errors.dueAt?.message}
            hint={
              lockedDue
                ? 'Задача просрочена: срок двигает только директор. Чтобы продлить, откройте задачу и нажмите «Запросить продление»'
                : `Рабочий день с ${workStart} до ${workEnd}`
            }
            className={formStyles.span2}
          >
            {lockedDue ? (
              <Input value={task ? fmtWhen(task.dueAt) : ''} disabled readOnly />
            ) : (
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
            )}
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
        </div>
        {extending && (
          <Field label="Причина продления срока" error={errors.dueReason?.message} hint="Например: ждём запчасть. Руководитель увидит причину в истории задачи">
            <Textarea {...form.register('dueReason')} rows={2} maxLength={500} />
          </Field>
        )}
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
        {!task && (
          <Field label="Файлы и фото" optional group hint="Скриншоты, фото, видео и документы: исполнитель увидит их в задаче">
            <div className="stack">
              <AttachmentList items={files} compact onDeleted={(id) => setFiles((l) => l.filter((x) => x.id !== id))} />
              <UploadButton target={{}} onUploaded={(items) => setFiles((l) => [...l, ...items])} label="Прикрепить" />
              <AttachHint />
            </div>
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
