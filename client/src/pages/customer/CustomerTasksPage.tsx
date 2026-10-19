import { useState } from 'react';
import { ListPlus, ListChecks, X } from 'lucide-react';
import { customerTaskSchema, type CustomerTask } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useCustomerTasks, useInvalidate } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { useConfirm } from '@/ui/Confirm';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner, Tabs } from '@/ui/Display';
import { Field, Input, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './Customer.module.css';

const STATUS: Record<CustomerTask['status'], { label: string; tone: string }> = {
  open: { label: 'В работе', tone: 'blue' },
  done: { label: 'Выполнена', tone: 'teal' },
  cancelled: { label: 'Отменена', tone: 'slate' },
};

export default function CustomerTasksPage() {
  useDocumentTitle('Мои задачи');
  const tasks = useCustomerTasks();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [creating, setCreating] = useState(false);
  const all = tasks.data ?? [];
  const open = all.filter((t) => t.status === 'open');
  const closed = all.filter((t) => t.status !== 'open');
  const list = tab === 'open' ? open : closed;

  return (
    <>
      <PageHeader
        title="Мои задачи"
        subtitle="Опишите, что нужно сделать. Задача сразу попадёт руководителю, а здесь вы увидите, как она движется."
        actions={
          <Button icon={<ListPlus size={18} aria-hidden />} onClick={() => setCreating(true)}>
            Поставить задачу
          </Button>
        }
      />
      <Tabs
        label="Статус задач"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'open', label: 'В работе', count: open.length },
          { value: 'closed', label: 'Завершённые', count: closed.length },
        ]}
      />
      <div style={{ height: 'var(--s-4)' }} />

      {tasks.isError ? (
        <ErrorBox error={tasks.error} />
      ) : !tasks.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={tab === 'open' ? 'Открытых задач нет' : 'Завершённых задач пока нет'}
          action={
            tab === 'open' ? (
              <Button icon={<ListPlus size={18} aria-hidden />} onClick={() => setCreating(true)}>
                Поставить задачу
              </Button>
            ) : undefined
          }
        >
          {tab === 'open' ? 'Поставьте задачу, и мы сразу возьмёмся за неё.' : 'Когда мы закончим работу, задача появится здесь.'}
        </EmptyState>
      ) : (
        <Card>
          <div className={s.list}>
            {list.map((t) => (
              <TaskItem key={t.id} task={t} />
            ))}
          </div>
        </Card>
      )}

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function TaskItem({ task }: { task: CustomerTask }) {
  const confirm = useConfirm();
  const toast = useToast();
  const inv = useInvalidate();
  const st = STATUS[task.status];
  return (
    <article className={s.item}>
      <div className={s.itemHead}>
        <h2 className={s.itemTitle}>{task.title}</h2>
        <Pill tone={st.tone} dot>
          {st.label}
        </Pill>
      </div>
      {task.description && <p className={s.itemText}>{task.description}</p>}
      <div className={s.meta}>
        <span>Поставлена {fmtWhen(task.createdAt)}</span>
        {task.status === 'open' ? (
          <>
            <span>Исполнитель: {task.assigneeName}</span>
            <span>Срок: {fmtWhen(task.dueAt)}</span>
          </>
        ) : (
          task.closedAt && <span>Закрыта {fmtWhen(task.closedAt)}</span>
        )}
      </div>
      {task.closeComment && (
        <div className={s.answer}>
          <b>{task.status === 'done' ? 'Ответ исполнителя' : 'Примечание'}</b>
          {task.closeComment}
        </div>
      )}
      {task.status === 'open' && (
        <div className={s.itemActions}>
          <Button
            variant="secondary"
            size="sm"
            icon={<X size={16} aria-hidden />}
            onClick={async () => {
              const ok = await confirm({
                title: 'Отменить задачу?',
                body: task.title,
                confirm: 'Отменить задачу',
                cancel: 'Оставить',
                danger: true,
              });
              if (!ok) return;
              try {
                await api.post(`/customer/tasks/${task.id}/cancel`);
                await inv('customerTasks');
                toast.success('Задача отменена');
              } catch (e) {
                toast.error('Не получилось отменить', e instanceof ApiError ? e.message : undefined);
              }
            }}
          >
            Отменить
          </Button>
        </div>
      )}
    </article>
  );
}

function NewTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const inv = useInvalidate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setTitle('');
    setDescription('');
    setDue('');
    setError('');
    onClose();
  };

  const submit = async () => {
    setError('');
    const input = { title, description, dueAt: due ? new Date(due).toISOString() : null };
    const parsed = customerTaskSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Проверьте поля');
    setBusy(true);
    try {
      await api.post('/customer/tasks', parsed.data);
      await inv('customerTasks');
      toast.success('Задача отправлена', 'Мы уже получили её и скоро возьмёмся за работу.');
      close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить задачу');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Новая задача"
      subtitle="Опишите, что нужно сделать"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button onClick={submit} loading={busy}>
            Отправить
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Что нужно сделать">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, заправить картриджи" data-autofocus />
        </Field>
        <Field label="Подробности" optional>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </Field>
        <Field label="Желаемый срок" optional hint="Если не указать, срок назначим сами">
          <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} step={900} />
        </Field>
      </form>
    </Sheet>
  );
}
