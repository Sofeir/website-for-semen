import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCheck, CheckCircle2, ListPlus, Search, X } from 'lucide-react';
import type { TaskListItem } from '@sd/shared';
import { pluralRu } from '@sd/shared';
import { useAuth, useMe } from '@/app/auth';
import { ApiError } from '@/api/http';
import { useCloseTasks, useTasks, type TaskFilters } from '@/api/queries';
import { addDays, startOfDay } from '@/lib/dates';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import { UserSelect } from '@/components/Pickers';
import { TaskRow } from '@/components/TaskRow';
import { TaskSheet } from '@/components/TaskSheet';
import { TaskFormSheet } from '@/components/TaskFormSheet';
import { Button } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/ui/Display';
import { Checkbox, Field, Input, Segmented, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './Tasks.module.css';

type Scope = 'mine' | 'created' | 'all';

function groupTasks(tasks: TaskListItem[]) {
  const today = startOfDay();
  const tomorrow = addDays(today, 1);
  const after = addDays(today, 2);
  const groups: { key: string; title: string; items: TaskListItem[] }[] = [
    { key: 'overdue', title: 'Просрочено', items: [] },
    { key: 'today', title: 'Сегодня', items: [] },
    { key: 'tomorrow', title: 'Завтра', items: [] },
    { key: 'later', title: 'Позже', items: [] },
  ];
  for (const t of tasks) {
    const due = new Date(t.dueAt);
    if (t.overdue) groups[0].items.push(t);
    else if (due < tomorrow) groups[1].items.push(t);
    else if (due < after) groups[2].items.push(t);
    else groups[3].items.push(t);
  }
  return groups.filter((g) => g.items.length);
}

export default function TasksPage() {
  useDocumentTitle('Задачи');
  const me = useMe();
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<Scope>((params.get('scope') as Scope) || 'mine');
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [q, setQ] = useState('');
  const [assignee, setAssignee] = useState('');
  const overdue = params.get('overdue') === '1';
  const dq = useDebounced(q.trim(), 250);
  const filters: TaskFilters = {
    scope: overdue && can('tasks.manageAll') ? 'all' : scope,
    status,
    q: dq,
    overdue,
    assignee: assignee ? Number(assignee) : '',
  };
  const tasks = useTasks(filters);
  const close = useCloseTasks();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [creating, setCreating] = useState(false);
  const openTaskId = Number(params.get('task')) || null;

  const list = tasks.data ?? [];
  const groups = useMemo(
    () => (status === 'open' ? groupTasks(list) : [{ key: 'done', title: 'Закрытые', items: list }]),
    [list, status],
  );
  const selectable = status === 'open';
  const canClose = (t: TaskListItem) => t.assigneeId === me.id || t.creatorId === me.id || can('tasks.manageAll');

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allIds = list.filter(canClose).map((t) => t.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const doClose = async () => {
    try {
      const r = await close.mutateAsync({ ids: [...selected], comment: comment || null });
      const othersNotified = list.filter((t) => r.closed.includes(t.id) && t.creatorId !== me.id).length;
      toast.success(
        `Закрыто: ${r.closed.length} ${pluralRu(r.closed.length, 'задача', 'задачи', 'задач')}`,
        othersNotified ? 'Постановщики получили уведомления' : undefined,
      );
      if (r.skipped.length) toast.error(`Не закрыто: ${r.skipped.length}`, 'Эти задачи уже закрыты или вам не принадлежат');
      setSelected(new Set());
      setComment('');
      setConfirmOpen(false);
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  const setTaskParam = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', String(id));
    else next.delete('task');
    setParams(next, { replace: true });
  };

  const scopeItems: { value: Scope; label: string }[] = [
    { value: 'mine', label: 'Мне' },
    { value: 'created', label: 'Поставленные мной' },
  ];
  if (can('tasks.manageAll')) scopeItems.push({ value: 'all', label: 'Все сотрудники' });

  return (
    <>
      <PageHeader
        title="Задачи"
        subtitle={overdue ? 'Только просроченные' : undefined}
        actions={
          <Button size="sm" icon={<ListPlus size={18} aria-hidden />} onClick={() => setCreating(true)}>
            Поставить задачу
          </Button>
        }
      />

      <div className={s.toolbar}>
        <Tabs
          label="Чьи задачи"
          items={scopeItems}
          value={scope}
          onChange={(v) => {
            setScope(v);
            setSelected(new Set());
            if (overdue) {
              const next = new URLSearchParams(params);
              next.delete('overdue');
              setParams(next, { replace: true });
            }
          }}
        />
        <div className={s.filters}>
          <Segmented
            label="Статус"
            layoutId="task-status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setSelected(new Set());
            }}
            options={[
              { value: 'open', label: 'Открытые' },
              { value: 'done', label: 'Закрытые' },
            ]}
          />
          {scope === 'all' && can('tasks.manageAll') && (
            <UserSelect
              aria-label="Исполнитель"
              placeholder="Все исполнители"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            />
          )}
          <Input
            icon={<Search aria-hidden />}
            type="search"
            placeholder="Поиск по задачам"
            aria-label="Поиск задач"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={s.search}
          />
        </div>
      </div>

      {selectable && allIds.length > 0 && (
        <div className={s.selectAll}>
          <Checkbox
            label={allSelected ? 'Снять выделение' : `Выбрать все (${allIds.length})`}
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
          />
        </div>
      )}

      {tasks.isError ? (
        <ErrorBox error={tasks.error} />
      ) : !tasks.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckCircle2 />} title={status === 'open' ? 'Открытых задач нет' : 'Закрытых задач нет'}>
            {status === 'open' ? 'Можно выдохнуть. Новые задачи придут уведомлением.' : 'Здесь появятся закрытые задачи.'}
          </EmptyState>
        </Card>
      ) : (
        <div className={s.groups}>
          {groups.map((g) => (
            <Card key={g.key} className={s.group}>
              <h2 className={s.groupTitle} data-tone={g.key}>
                {g.title}
                <span className={s.groupCount}>{g.items.length}</span>
              </h2>
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  selected={selected.has(t.id)}
                  onToggle={selectable && canClose(t) ? () => toggle(t.id) : undefined}
                  onOpen={() => setTaskParam(t.id)}
                  showAssignee={scope !== 'mine' || overdue}
                />
              ))}
            </Card>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            className={s.bulkBar}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="region"
            aria-label="Действия с выбранными задачами"
          >
            <span className={s.bulkCount}>
              Выбрано: <b className="num">{selected.size}</b>
            </span>
            <Button variant="ghost" size="sm" icon={<X size={16} aria-hidden />} onClick={() => setSelected(new Set())}>
              Снять
            </Button>
            <Button variant="success" size="sm" icon={<CheckCheck size={18} aria-hidden />} onClick={() => setConfirmOpen(true)}>
              Закрыть выбранные
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Закрыть ${selected.size} ${pluralRu(selected.size, 'задачу', 'задачи', 'задач')}?`}
        subtitle="Если задачу ставил другой сотрудник, он получит уведомление с комментарием."
        width={480}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button variant="success" loading={close.isPending} onClick={doClose} icon={<CheckCheck size={18} aria-hidden />}>
              Закрыть
            </Button>
          </>
        }
      >
        <Field label="Комментарий" optional>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            data-autofocus
            placeholder="Например: всё сделано, клиент предупреждён"
          />
        </Field>
      </Sheet>

      <TaskSheet taskId={openTaskId} onClose={() => setTaskParam(null)} />
      <TaskFormSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
