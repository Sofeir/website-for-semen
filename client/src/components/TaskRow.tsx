import { Check, Clock, Link2, UserRound } from 'lucide-react';
import type { TaskListItem } from '@sd/shared';
import { fmtWhen } from '@/lib/dates';
import { cx } from '@/ui/Button';
import { Pill } from '@/ui/Display';
import s from './rows.module.css';

interface TaskRowProps {
  task: TaskListItem;
  /** Режим выбора для массового закрытия. */
  selected?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  showAssignee?: boolean;
  checkLabel?: string;
}

export function TaskRow({ task, selected, onToggle, onOpen, showAssignee, checkLabel }: TaskRowProps) {
  const done = task.status !== 'open';
  return (
    <div className={cx(s.row, done && s.done)}>
      {onToggle && (
        <button
          type="button"
          className={cx(s.checkBtn, (selected || done) && s.checked)}
          role="checkbox"
          aria-checked={Boolean(selected || done)}
          aria-label={checkLabel ?? `Отметить: ${task.title}`}
          onClick={onToggle}
          disabled={done}
        >
          <span className={s.checkCircle}>
            <Check strokeWidth={3} aria-hidden />
          </span>
        </button>
      )}
      <button type="button" className={s.rowLink} onClick={onOpen} style={{ textAlign: 'left' }}>
        <span className={s.main}>
          <span className={s.title}>{task.title}</span>
          <span className={s.meta}>
            <span className={cx(s.metaItem, task.overdue && s.late)}>
              <Clock aria-hidden />
              {done ? `закрыта ${fmtWhen(task.closedAt)}` : `${task.overdue ? 'просрочена: ' : 'до '}${fmtWhen(task.dueAt)}`}
            </span>
            {showAssignee && (
              <span className={s.metaItem}>
                <UserRound aria-hidden />
                {task.assigneeName}
              </span>
            )}
            {task.orderNumber && (
              <span className={s.metaItem}>
                <Link2 aria-hidden />№{task.orderNumber}
              </span>
            )}
            {task.clientName && !task.orderNumber && <span className={s.metaItem}>{task.clientName}</span>}
            {task.isStageTask && <Pill tone="outline">этап заявки</Pill>}
          </span>
        </span>
      </button>
    </div>
  );
}
