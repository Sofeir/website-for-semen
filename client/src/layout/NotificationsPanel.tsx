import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { BellOff, CheckCheck, Trash2 } from 'lucide-react';
import { api } from '@/api/http';
import { useInvalidate, useNotifications } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { smoothScrollList } from '@/lib/smoothWheel';
import { Button, cx } from '@/ui/Button';
import { EmptyState, ErrorBox, Pill, Spinner } from '@/ui/Display';
import s from './NotificationsPanel.module.css';

const TASK_STATE: Record<string, { label: string; tone: string }> = {
  overdue: { label: 'Сейчас: просрочена', tone: 'red' },
  open: { label: 'Сейчас: в работе', tone: 'blue' },
  awaiting: { label: 'Сейчас: ожидает выдачи', tone: 'violet' },
  closed: { label: 'Сейчас: закрыта', tone: 'teal' },
};

export function NotificationsPanel({ variant, onClose }: { variant: 'popover' | 'sheet'; onClose: () => void }) {
  const q = useNotifications();
  const inv = useInvalidate();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => (listRef.current ? smoothScrollList(listRef.current) : undefined), []);

  useEffect(() => {
    if (variant !== 'popover') return;
    const onDoc = (e: MouseEvent) => {
      const bell = (e.target as HTMLElement).closest('[data-tour="bell"]');
      if (!ref.current?.contains(e.target as Node) && !bell) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [variant, onClose]);

  // «Очистить все» срабатывает со второго нажатия, чтобы не стереть список случайно
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const clearAll = async () => {
    if (!confirmClear) return setConfirmClear(true);
    setConfirmClear(false);
    await api.del('/notifications');
    inv('notifications');
  };

  const remove = async (id: number) => {
    await api.del(`/notifications/${id}`);
    inv('notifications');
  };

  const readAll = async () => {
    await api.post('/notifications/read');
    inv('notifications');
  };

  const open = async (id: number, link: string | null, isRead: boolean) => {
    // Уведомления об одной задаче или заявке отмечаются прочитанными вместе
    if (!isRead) api.post(link ? '/notifications/read' : `/notifications/${id}/read`, link ? { link } : undefined).then(() => inv('notifications'));
    onClose();
    if (link) navigate(link);
  };

  const body = q.isLoading ? (
    <Spinner />
  ) : q.isError ? (
    <ErrorBox error={q.error} />
  ) : !q.data?.items.length ? (
    <EmptyState icon={<BellOff />} title="Уведомлений пока нет">
      Здесь появятся новые задачи, передачи заявок и закрытые задачи.
    </EmptyState>
  ) : (
    <ul className={s.list}>
      {q.data.items.map((n) => (
        <li key={n.id} className={s.row}>
          <button type="button" className={cx(s.item, !n.isRead && s.unread)} onClick={() => open(n.id, n.link, n.isRead)}>
            <span className={s.dot} aria-hidden />
            <span className={s.text}>
              <span className={s.title}>{n.title}</span>
              {n.body && <span className={s.body}>{n.body}</span>}
              {n.taskState && TASK_STATE[n.taskState] && (
                <span className={s.state}>
                  <Pill tone={TASK_STATE[n.taskState].tone}>{TASK_STATE[n.taskState].label}</Pill>
                  {n.taskState !== 'closed' && n.taskDueAt && <span className={s.stateDue}>срок: {fmtWhen(n.taskDueAt)}</span>}
                </span>
              )}
              <time className={s.time}>{fmtWhen(n.createdAt)}</time>
            </span>
          </button>
          <button type="button" className={s.trash} aria-label="Удалить уведомление" title="Удалить уведомление" onClick={() => remove(n.id)}>
            <Trash2 size={16} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );

  const head = (
    <div className={s.head}>
      {variant === 'popover' && <b className={s.headTitle}>Уведомления</b>}
      <div className={s.headActions}>
        {Boolean(q.data?.unread) && (
          <Button variant="ghost" size="sm" icon={<CheckCheck size={18} aria-hidden />} onClick={readAll}>
            Прочитать все
          </Button>
        )}
        {Boolean(q.data?.items.length) && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={18} aria-hidden />} onClick={clearAll}>
            {confirmClear ? 'Точно очистить?' : 'Очистить все'}
          </Button>
        )}
      </div>
    </div>
  );

  if (variant === 'sheet') {
    return (
      <div className={s.sheet}>
        {head}
        {body}
      </div>
    );
  }
  return (
    <motion.div
      ref={ref}
      className={s.popover}
      role="dialog"
      aria-label="Уведомления"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16 }}
    >
      {head}
      <div className={s.scroll} ref={listRef}>
        {body}
      </div>
    </motion.div>
  );
}
