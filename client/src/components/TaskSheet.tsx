import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, CalendarClock, Check, ClipboardList, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { TaskStep } from '@sd/shared';
import { useAuth, useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useCloseTasks, useInvalidate, useMarkSeen, useSettings, useTask, useTransferTask } from '@/api/queries';
import { defaultDueDate, fmtWhen } from '@/lib/dates';
import { Button, ButtonLink } from '@/ui/Button';
import { DescList, ErrorBox, Pill, Spinner } from '@/ui/Display';
import { Checkbox, Field, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { AttachHint, AttachmentList, UploadButton } from './Attachments';
import { useConfirm } from '@/ui/Confirm';
import { useToast } from '@/ui/Toast';
import { DueInput, UserSelect } from './Pickers';
import { TaskFormSheet } from './TaskFormSheet';
import { VisitDevices } from './VisitDevices';
import s from './TaskSheet.module.css';

type Mode = 'view' | 'close' | 'transfer' | 'request' | 'extend';

interface ChainNode {
  key: string;
  name: string;
  meta: string;
  comment?: string | null;
  done: boolean;
}

/**
 * Цепочка передачи как последовательность людей: кто поставил, кому передали, кто перехватил и вернул.
 * Если задачу передал тот, кто ею не владел (например, директор спросил исполнителя), он появляется в цепочке отдельным шагом.
 */
function buildChain(steps: TaskStep[]): ChainNode[] {
  const nodes: ChainNode[] = [];
  let holders: string[] = [];
  let i = 0;
  while (i < steps.length) {
    const batch = [steps[i]];
    while (
      i + batch.length < steps.length &&
      steps[i + batch.length].assignedAt === batch[0].assignedAt &&
      steps[i + batch.length].fromUserName === batch[0].fromUserName
    ) {
      batch.push(steps[i + batch.length]);
    }
    i += batch.length;
    const from = batch[0].fromUserName;
    const inserted = Boolean(from && !holders.includes(from) && !batch.some((b) => b.assigneeName === from));
    if (inserted) {
      nodes.push({
        key: `from-${batch[0].id}`,
        name: from!,
        meta: `${nodes.length ? 'передал(а) задачу' : 'поставил(а) задачу'}, ${fmtWhen(batch[0].assignedAt)}`,
        comment: batch[0].comment,
        done: true,
      });
    }
    for (const st of batch) {
      nodes.push({
        key: String(st.id),
        name: st.assigneeName,
        meta: `${from && from !== st.assigneeName ? `от ${from}, ` : ''}${fmtWhen(st.assignedAt)}${st.dueAt ? `, срок ${fmtWhen(st.dueAt)}` : ''}`,
        comment: inserted ? null : st.comment,
        done: Boolean(st.doneAt),
      });
    }
    holders = batch.map((b) => b.assigneeName);
  }
  return nodes;
}

export function TaskSheet({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  const me = useMe();
  const { can } = useAuth();
  const q = useTask(taskId);
  const task = q.data;
  const toast = useToast();
  const confirm = useConfirm();
  const inv = useInvalidate();
  const settings = useSettings();
  const close = useCloseTasks();
  const transfer = useTransferTask(taskId ?? 0);
  useMarkSeen(taskId ? `/tasks?task=${taskId}` : null);
  const [mode, setMode] = useState<Mode>('view');
  const [comment, setComment] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const canCheck = Boolean(
    task && task.status === 'open' && (task.assigneeIds.includes(me.id) || task.creatorId === me.id || can('tasks.manageAll')),
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
  }, [taskId]);

  // Срок в формах передачи и продления по умолчанию нынешний: при передаче он не меняется, при продлении выбирают позже
  useEffect(() => {
    if (task) setDue(task.dueAt);
  }, [task?.id, task?.dueAt]);

  const canTouch = task && (task.assigneeIds.includes(me.id) || task.creatorId === me.id || can('tasks.manageAll'));
  // Просроченную задачу закрывает только руководитель: остальные просят его подтвердить.
  const needsManager = Boolean(task && task.status === 'open' && task.overdue && !me.confirmsOverdue);
  const canEdit = Boolean(task && canTouch && task.status === 'open');
  // Передал не тому: передавший задачу может передать её заново, пока она у адресата (других прав у него нет)
  const canRedirect = Boolean(task && !canTouch && task.status === 'open' && task.handedOverById === me.id);

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

  const doRequest = async () => {
    setError('');
    try {
      await api.post(`/tasks/${task!.id}/close-request`, { comment: comment.trim() });
      toast.success('Запрос отправлен', 'Руководитель получил уведомление и подтвердит закрытие');
      setMode('view');
      setComment('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  // Передача самому себе: переносит срок, пока он не прошёл; у просроченной задачи срок согласует директор
  const toSelf = assignee !== '' && Number(assignee) === me.id;
  // У просроченной задачи прежний срок уже в прошлом: при передаче себе предлагаем завтрашний, чтобы не получить ошибку «срок должен быть позже»
  useEffect(() => {
    if (toSelf && task?.overdue) setDue(defaultDueDate(settings.data?.work, 1).toISOString());
  }, [toSelf, task?.overdue, settings.data?.work]);
  const doTransfer = async () => {
    setError('');
    if (!assignee) return setError('Выберите, кому передать');
    if (comment.trim().length < 3) return setError('Напишите причину передачи и что уже сделано');
    try {
      const r = await transfer.mutateAsync({ assigneeId: Number(assignee), dueAt: me.confirmsOverdue || toSelf ? due : task!.dueAt, comment: comment.trim() });
      if (r.requested) toast.success('Запрос отправлен', 'Задача просрочена: срок согласует директор, он получил уведомление');
      else toast.success(toSelf ? 'Срок обновлён' : 'Задача передана');
      setMode('view');
      setComment('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const doExtend = async () => {
    setError('');
    if (!due || new Date(due) <= new Date(task!.dueAt)) return setError('Выберите срок позже нынешнего');
    if (comment.trim().length < 3) return setError('Напишите, почему нужно больше времени');
    try {
      await api.post(`/tasks/${task!.id}/extend-request`, { dueAt: due, comment: comment.trim() });
      toast.success('Запрос отправлен', 'Директор получил уведомление и решит');
      setMode('view');
      setComment('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const startExtend = () => {
    setDue(new Date(Math.max(Date.now(), new Date(task!.dueAt).getTime()) + 24 * 3600_000).toISOString());
    setComment('');
    setMode('extend');
  };

  // Временная возможность: удалить закрытую задачу навсегда, без доступа к серверу
  const removeTask = async () => {
    const ok = await confirm({
      title: 'Удалить задачу навсегда?',
      body: 'Задача исчезнет отовсюду, в том числе из отчётов, вместе с файлами и историей. Вернуть её будет нельзя.',
      confirm: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/tasks/${task!.id}`);
      inv('tasks', 'task', 'dashboard', 'order', 'report', 'notifications');
      toast.success('Задача удалена');
      onClose();
    } catch (e) {
      toast.error('Не получилось удалить', (e as ApiError).message);
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
  if (task && canRedirect) {
    footer =
      mode === 'transfer' ? (
        <>
          <Button variant="secondary" onClick={() => setMode('view')}>
            Назад
          </Button>
          <Button loading={transfer.isPending} onClick={doTransfer} icon={<ArrowRightLeft size={18} aria-hidden />}>
            Передать
          </Button>
        </>
      ) : (
        <Button variant="secondary" icon={<ArrowRightLeft size={18} aria-hidden />} onClick={() => setMode('transfer')}>
          Передал не тому: передать заново
        </Button>
      );
  } else if (task && canTouch) {
    if (task.status !== 'open') {
      footer = (
        <>
          {can('tasks.manageAll') && (
            <Button variant="danger" icon={<Trash2 size={18} aria-hidden />} onClick={removeTask}>
              Удалить
            </Button>
          )}
          <Button variant="secondary" icon={<RotateCcw size={18} aria-hidden />} onClick={reopen}>
            Вернуть в работу
          </Button>
        </>
      );
    } else if (mode === 'view') {
      footer = (
        <>
          {task.isStageTask && task.orderId && can('workspace.view') && (
            <ButtonLink to={`/orders/${task.orderId}`} icon={<ClipboardList size={18} aria-hidden />}>
              Открыть заявку
            </ButtonLink>
          )}
          <Button variant="secondary" icon={<ArrowRightLeft size={18} aria-hidden />} onClick={() => setMode('transfer')}>
            Передать
          </Button>
          {needsManager ? (
            <Button variant="success" icon={<Send size={18} aria-hidden />} onClick={() => setMode('request')}>
              Запросить подтверждение
            </Button>
          ) : (
            <Button variant="success" icon={<Check size={18} aria-hidden />} onClick={() => setMode('close')}>
              Закрыть задачу
            </Button>
          )}
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
          ) : mode === 'request' ? (
            <Button variant="success" onClick={doRequest} icon={<Send size={18} aria-hidden />}>
              Отправить
            </Button>
          ) : mode === 'extend' ? (
            <Button onClick={doExtend} icon={<Send size={18} aria-hidden />}>
              Отправить запрос
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
                ) : task.awaitingIssue ? (
                  <Pill tone="violet" dot>
                    Ожидает выдачи
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
              <div className={s.tools}>
                <Button variant="ghost" size="sm" icon={<Pencil size={16} aria-hidden />} onClick={() => setEditing(true)}>
                  Изменить
                </Button>
                {!me.confirmsOverdue && task.overdue && (
                  <Button variant="ghost" size="sm" icon={<CalendarClock size={16} aria-hidden />} onClick={startExtend}>
                    Запросить продление
                  </Button>
                )}
              </div>
            )}
            {error && <ErrorBox>{error}</ErrorBox>}
            {mode === 'close' && (
              <Field label="Комментарий для постановщика" optional hint="Постановщик получит уведомление с этим текстом">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} data-autofocus maxLength={2000} />
              </Field>
            )}
            {mode === 'request' && (
              <Field
                label="Что сделано"
                optional
                hint="Задача просрочена, поэтому закрыть её может только директор. Он получит уведомление с этим текстом"
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} data-autofocus maxLength={2000} />
              </Field>
            )}
            {mode === 'extend' && (
              <>
                <Field label="Новый крайний срок" hint={`Сейчас — ${fmtWhen(task.dueAt)}. Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}>
                  <DueInput value={due} onChange={setDue} />
                </Field>
                <Field label="Почему нужно больше времени" hint="Директор получит уведомление с этим текстом">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} data-autofocus />
                </Field>
              </>
            )}
            {mode === 'transfer' && (
              <>
                <Field label="Кому передать">
                  <UserSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} data-autofocus />
                </Field>
                {me.confirmsOverdue || toSelf || !task.overdue ? (
                  <Field
                    label="Крайний срок"
                    hint={
                      toSelf && task.overdue && !me.confirmsOverdue
                        ? 'Задача просрочена: новый срок согласует директор, ему уйдёт запрос'
                        : `Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`
                    }
                  >
                    <DueInput value={due} onChange={setDue} />
                  </Field>
                ) : (
                  <p className="muted">
                    Задача просрочена, срок остаётся прежним: {fmtWhen(task.dueAt)}. Если нужно больше времени, запросите продление: срок двигает только директор.
                  </p>
                )}
                <Field label="Причина передачи и что уже сделано" hint="Увидят постановщик и руководитель">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
                </Field>
              </>
            )}
            {mode === 'view' && (
              <>
                {task.status === 'open' && task.isStageTask && task.orderId && can('workspace.view') && (
                  <p className={s.stageHint}>
                    Это задача этапа заявки №{task.orderNumber}. Чтобы выполнить этап (например, согласовать), откройте заявку и переведите её дальше:
                    задача закроется сама. Закрывать её здесь не нужно.
                  </p>
                )}
                {task.description && <p className={s.desc}>{task.description}</p>}
                <DescList
                  items={[
                    [task.assigneeIds.length > 1 ? 'Ответственные' : 'Исполнитель', task.assigneeName],
                    [task.watcherIds.length > 1 ? 'Наблюдатели' : 'Наблюдатель', task.watcherName],
                    ['Постановщик', task.creatorName],
                    ['Начало', fmtWhen(task.startAt)],
                    ['Крайний срок', <span className={task.overdue ? s.late : undefined}>{fmtWhen(task.dueAt)}</span>],
                    [
                      'Заявка',
                      task.orderId &&
                        (can('workspace.view') ? (
                          <Link to={`/orders/${task.orderId}`}>№{task.orderNumber}</Link>
                        ) : (
                          `№${task.orderNumber}`
                        )),
                    ],
                    [
                      'Клиент',
                      task.clientId &&
                        (can('workspace.view') ? (
                          <Link to={`/clients/${task.clientId}`}>{task.clientName}</Link>
                        ) : (
                          task.clientName
                        )),
                    ],
                    ['Закрыта', task.closedAt && `${fmtWhen(task.closedAt)}, ${task.closedByName ?? ''}`],
                    ['Комментарий', task.closeComment],
                  ]}
                />
                {task.isVisit && task.clientId && (
                  <VisitDevices taskId={task.id} clientId={task.clientId} canEdit={canCheck} />
                )}
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
                {(task.attachments.length > 0 || canTouch) && (
                  <section>
                    <h3 className={s.chainTitle}>Файлы и фото{task.attachments.length > 0 && ` · ${task.attachments.length}`}</h3>
                    {task.attachments.length > 0 ? (
                      <AttachmentList items={task.attachments} onDeleted={() => inv('task')} />
                    ) : (
                      <AttachHint />
                    )}
                    {canTouch && (
                      <div className={s.files}>
                        <UploadButton target={{ taskId: task.id }} onUploaded={() => inv('task')} label="Добавить фото или файл" />
                      </div>
                    )}
                  </section>
                )}
                {task.steps.length > 0 && (
                  <section>
                    <h3 className={s.chainTitle}>Цепочка передачи</h3>
                    <ol className={s.chain}>
                      {buildChain(task.steps).map((st, i) => (
                        <li key={st.key} className={s.step} data-done={st.done}>
                          <span className={s.stepNum}>{String(i + 1).padStart(2, '0')}</span>
                          <div className={s.stepBody}>
                            <b>{st.name}</b>
                            <span className={s.stepMeta}>{st.meta}</span>
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
