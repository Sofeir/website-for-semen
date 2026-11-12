import { ListPlus } from 'lucide-react';
import type { OrderDetail, StageHistoryItem, TaskListItem } from '@sd/shared';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Card, CardHead, Pill } from '@/ui/Display';
import s from './OrderPage.module.css';

/** Задача этапа, которая шла в этой записи истории: нужного этапа и начатая вместе с записью. */
function taskForEntry(tasks: TaskListItem[], h: StageHistoryItem): TaskListItem | null {
  const list = tasks
    .filter((t) => t.isStageTask && t.stageId === h.stageId)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  if (!list.length) return null;
  const at = new Date(h.startedAt).getTime();
  let pick = list[0]!;
  for (const t of list) if (new Date(t.startAt).getTime() <= at + 60_000) pick = t;
  return pick;
}

type Entry =
  | { key: string; at: number; type: 'stage'; h: StageHistoryItem; task: TaskListItem | null }
  | { key: string; at: number; type: 'task'; task: TaskListItem };

/**
 * История заявки: этапы, передачи и обычные задачи одним списком, новое сверху. Записи кликабельны:
 * нажатие открывает задачу этапа или саму задачу. Здесь же видно, чем закончился этап (комментарий закрытия задачи).
 */
export function OrderHistory({
  order,
  onOpenTask,
  onNewTask,
}: {
  order: OrderDetail;
  onOpenTask: (id: number) => void;
  onNewTask: () => void;
}) {
  const entries: Entry[] = [
    ...order.history.map<Entry>((h) => ({ key: `h${h.id}`, at: new Date(h.startedAt).getTime(), type: 'stage', h, task: taskForEntry(order.tasks, h) })),
    ...order.tasks.filter((t) => !t.isStageTask).map<Entry>((t) => ({ key: `t${t.id}`, at: new Date(t.startAt).getTime(), type: 'task', task: t })),
  ].sort((a, b) => b.at - a.at);

  return (
    <Card id="focus-history">
      <CardHead title="История">
        <Button variant="ghost" size="sm" icon={<ListPlus size={18} aria-hidden />} onClick={onNewTask}>
          Задача
        </Button>
      </CardHead>
      <ol className={s.history}>
        {entries.map((e) => {
          if (e.type === 'task') {
            const t = e.task;
            return (
              <li key={e.key} className={s.hItem} data-open={t.status === 'open'}>
                <span className={s.hDot} aria-hidden />
                <button type="button" className={s.hBtn} onClick={() => onOpenTask(t.id)}>
                  <b>
                    {t.title}
                    <span className={s.hWho}>, {t.assigneeName}</span>
                  </b>
                  <span className={s.hMeta}>
                    Задача, {fmtWhen(e.at ? new Date(e.at).toISOString() : t.startAt)}
                    {t.status === 'open' ? `, срок ${fmtWhen(t.dueAt)}` : `, закрыта ${t.closedAt ? fmtWhen(t.closedAt) : ''}`}
                  </span>
                  {t.status === 'open' && t.overdue && <Pill tone="red">просрочена</Pill>}
                  {t.status !== 'open' && t.closeComment && <span className={s.hComment}>{t.closeComment}</span>}
                </button>
              </li>
            );
          }
          const { h, task } = e;
          const result = task && task.status !== 'open' && task.closeComment && task.closeComment !== h.comment ? task.closeComment : null;
          const body = (
            <>
              <b>
                {h.kind === 'transfer' ? `Передано: ${h.responsibleName ?? '—'}` : h.kind === 'reopen' ? `Открыта заново: ${h.stageName}` : h.stageName}
                {h.kind !== 'transfer' && h.responsibleName && <span className={s.hWho}>, {h.responsibleName}</span>}
              </b>
              <span className={s.hMeta}>
                {fmtWhen(h.startedAt)}
                {h.fromUserName && h.kind !== 'stage' && `, от ${h.fromUserName}`}
                {h.dueAt && !h.finishedAt && `, срок ${fmtWhen(h.dueAt)}`}
              </span>
              {h.comment && <span className={s.hComment}>{h.comment}</span>}
              {result && (
                <span className={s.hComment}>
                  Итог этапа{task?.closedByName ? ` (${task.closedByName})` : ''}: {result}
                </span>
              )}
            </>
          );
          return (
            <li key={e.key} className={s.hItem} data-open={!h.finishedAt}>
              <span className={s.hDot} aria-hidden />
              {task ? (
                <button type="button" className={s.hBtn} onClick={() => onOpenTask(task.id)}>
                  {body}
                </button>
              ) : (
                <div className={s.hBody}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
