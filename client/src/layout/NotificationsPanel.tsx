import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { BellOff, CheckCheck } from 'lucide-react';
import { api } from '@/api/http';
import { useInvalidate, useNotifications } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { smoothScrollList } from '@/lib/smoothWheel';
import { Button, cx } from '@/ui/Button';
import { EmptyState, ErrorBox, Spinner } from '@/ui/Display';
import s from './NotificationsPanel.module.css';

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

  const readAll = async () => {
    await api.post('/notifications/read');
    inv('notifications');
  };

  const open = async (id: number, link: string | null, isRead: boolean) => {
    if (!isRead) api.post(`/notifications/${id}/read`).then(() => inv('notifications'));
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
        <li key={n.id}>
          <button type="button" className={cx(s.item, !n.isRead && s.unread)} onClick={() => open(n.id, n.link, n.isRead)}>
            <span className={s.dot} aria-hidden />
            <span className={s.text}>
              <span className={s.title}>{n.title}</span>
              {n.body && <span className={s.body}>{n.body}</span>}
              <time className={s.time}>{fmtWhen(n.createdAt)}</time>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  const head = (
    <div className={s.head}>
      {variant === 'popover' && <b className={s.headTitle}>Уведомления</b>}
      {Boolean(q.data?.unread) && (
        <Button variant="ghost" size="sm" icon={<CheckCheck size={18} aria-hidden />} onClick={readAll}>
          Прочитать все
        </Button>
      )}
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
