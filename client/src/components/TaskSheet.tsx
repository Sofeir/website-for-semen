import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Check, Pencil, RotateCcw } from 'lucide-react';
import { useAuth, useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useCloseTasks, useInvalidate, useSettings, useTask, useTransferTask } from '@/api/queries';
import { defaultDueDate, fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { DescList, ErrorBox, Pill, Spinner } from '@/ui/Display';
import { Checkbox, Field, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { DueInput, UserSelect } from './Pickers';
import { TaskFormSheet } from './TaskFormSheet';
import s from './TaskSheet.module.css';

type Mode = 'view' | 'close' | 'transfer';

export function TaskSheet({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  const me = useMe();
  const { can } = useAuth();
  const q = useTask(taskId);
  const task = q.data;
  const toast = useToast();
  const inv = useInvalidate();
  const settings = useSettings();
  const close = useCloseTasks();
  const transfer = useTransferTask(taskId ?? 0);
  const [mode, setMode] = useState<Mode>('view');
  const [comment, setComment] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const canCheck = Boolean(
    task && task.status === 'open' && (task.assigneeId === me.id || task.creatorId === me.id || can('tasks.manageAll')),
  );
  const toggleItem = async (itemId: number, done: boolean) => {
    if (!task) return;
    setToggling(itemId);
    try {
      await api.post(`/tasks/${task.id}/checklist/${itemId}`, { done });
      inv('task', 'tasks');
    } catch (e) {
      toast.error('Не получилось отметить', (e as ApiError).message);
    } finally {
      setToggling(null);
    }
  };

  useEffect(() => {
    setMode('view');
    setComment('');
    setAssignee('');
    setError('');
    setDue(defaultDueDate(settings.data?.work).toISOString());
  }, [taskId, settings.data?.work]);

  const canTouch = task && (task.assigneeId === me.id || task.creatorId === me.id || can('tasks.manageAll'));
  const canEdit = task && (task.creatorId === me.id || can('tasks.manageAll')) && task.status === 'open';

  const doClose = async () => {
    setError('');
    try {
      await close.mutateAsync({ ids: [task!.id], comment: comment || null });
      toast.success('Задача закрыта', task!.creatorId !== me.id ? `${task!.creatorName} получит уведомление` : undefined);
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const doTransfer = async () => {
    setError('');
    if (!assignee) return setError('Выберите, кому передать');
    try {
      await transfer.mutateAsync({ assigneeId: Number(assignee), dueAt: due, comment: comment || null });
      toast.success('Задача передана');
      setMode('view');
      setComment('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const reopen = async () => {
    try {
      await api.post(`/tasks/${task!.id}/reopen`);
      inv('tasks', 'task', 'dashboard');
      toast.success('Задача снова в работе');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  let footer = null;
  if (task && canTouch) {
    if (task.status !== 'open') {
      footer = (
        <Button variant="secondary" icon={<RotateCcw size={18} aria-hidden />} onClick={reopen}>
          Вернуть в работу
        </Button>
      );
    } else if (mode === 'view') {
      footer = (
        <>
          <Button variant="secondary" icon={<ArrowRightLeft size={18} aria-hidden />} onClick={() => setMode('transfer')}>
            Передать
          </Button>
          <Button variant="success" icon={<Check size={18} aria-hidden />} onClick={() => setMode('close')}>
            Закрыть задачу
          </Button>
        </>
      );
    } else {
      footer = (
        <>
          <Button variant="secondary" onClick={() => setMode('view')}>
            Назад
          </Button>
          {mode === 'close' ? (
            <Button variant="success" loading={close.isPending} onClick={doClose} icon={<Check size={18} aria-hidden />}>
              Закрыть
            </Button>
          ) : (
            <Button loading={transfer.isPending} onClick={doTransfer} icon={<ArrowRightLeft size={18} aria-hidden />}>
              Передать
            </Button>
          )}
        </>
      );
    }
  }

  return (
    <>
      <Sheet
        open={Boolean(taskId) && !editing}
        onClose={onClose}
        title={task?.title ?? 'Задача'}
        subtitle={
          task && (
            <span className={s.pills}>
              {task.status === 'open' ? (
                task.overdue ? (
                  <Pill tone="red" dot>
                    Просрочена
                  </Pill>
                ) : (
                  <Pill tone="blue" dot>
                    В работе
                  </Pill>
                )
              ) : (
                <Pill tone="teal" dot>
                  Закрыта
                </Pill>
              )}
              {task.fromCustomer && <Pill tone="blue">От заказчика</Pill>}
              {task.isStageTask && <Pill tone="outline">Этап заявки</Pill>}
            </span>
          )
        }
        footer={footer}
        width={600}
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorBox error={q.error} />
        ) : task ? (
          <div className="stack">
            {canEdit && mode === 'view' && (
              <div>
                <Button variant="ghost" size="sm" icon={<Pencil size={16} aria-hidden />} onClick={() => setEditing(true)}>
                  Изменить
                </Button>
              </div>
            )}
            {error && <ErrorBox>{error}</ErrorBox>}
            {mode === 'close' && (
              <Field label="Комментарий для постановщика" optional hint="Постановщик получит уведомление с этим текстом">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} data-autofocus maxLength={2000} />
              </Field>
            )}
            {mode === 'transfer' && (
              <>
                <Field label="Кому передать">
                  <UserSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} data-autofocus />
                </Field>
                <Field label="Новый срок" hint={`Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}>
                  <DueInput value={due} onChange={setDue} />
                </Field>
                <Field label="Комментарий" optional>
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
                </Field>
              </>
            )}
            {mode === 'view' && (
              <>
                {task.description && <p className={s.desc}>{task.description}</p>}
                <DescList
                  items={[
                    ['Исполнитель', task.assigneeName],
                    ['Постановщик', task.creatorName],
                    ['Начало', fmtWhen(task.startAt)],
                    ['Срок', <span className={task.overdue ? s.late : undefined}>{fmtWhen(task.dueAt)}</span>],
                    ['Крайний срок', task.deadlineAt && fmtWhen(task.deadlineAt)],
                    ['Заявка', task.orderId && <Link to={`/orders/${task.orderId}`}>№{task.orderNumber}</Link>],
                    ['Клиент', task.clientId && <Link to={`/clients/${task.clientId}`}>{task.clientName}</Link>],
                    ['Закрыта', task.closedAt && `${fmtWhen(task.closedAt)}, ${task.closedByName ?? ''}`],
                    ['Комментарий', task.closeComment],
                  ]}
                />
                {task.checklist.length > 0 && (
                  <section>
                    <h3 className={s.chainTitle}>
                      Чек-лист · {task.checklist.filter((x) => x.done).length} из {task.checklist.length}
                    </h3>
                    <ul className={s.checklist}>
                      {task.checklist.map((it) => (
                        <li key={it.id}>
                          <Checkbox
                            label={it.title}
                            checked={it.done}
                            disabled={!canCheck || toggling === it.id}
                            onChange={(e) => toggleItem(it.id, e.target.checked)}
                          />
                          {it.done && it.doneAt && (
                            <span className={s.checkMeta}>
                              {it.doneByName}, {fmtWhen(it.doneAt)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {task.steps.length > 0 && (
                  <section>
                    <h3 className={s.chainTitle}>Цепочка передачи</h3>
                    <ol className={s.chain}>
                      {task.steps.map((st, i) => (
                        <li key={st.id} className={s.step} data-done={Boolean(st.doneAt)}>
                          <span className={s.stepNum}>{String(i + 1).padStart(2, '0')}</span>
                          <div className={s.stepBody}>
                            <b>{st.assigneeName}</b>
                            <span className={s.stepMeta}>
                              {st.fromUserName ? `от ${st.fromUserName}, ` : ''}
                              {fmtWhen(st.assignedAt)}
                              {st.dueAt && `, срок ${fmtWhen(st.dueAt)}`}
                            </span>
                            {st.comment && <span className={s.stepComment}>{st.comment}</span>}
                          </div>
                        </li>
                      ))}
                      <li className={s.step} data-done={task.status !== 'open'}>
                        <span className={s.stepNum}>{task.status !== 'open' ? <Check size={14} aria-hidden /> : '…'}</span>
                        <div className={s.stepBody}>
                          <b>{task.status !== 'open' ? 'Готово' : 'В работе'}</b>
                          {task.closedAt && <span className={s.stepMeta}>{fmtWhen(task.closedAt)}</span>}
                        </div>
                      </li>
                    </ol>
                  </section>
                )}
              </>
            )}
          </div>
        ) : null}
      </Sheet>
      {task && editing && <TaskFormSheet open task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
