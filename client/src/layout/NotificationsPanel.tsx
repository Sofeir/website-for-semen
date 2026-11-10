import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { BellOff, CheckCheck, ChevronDown, Trash2 } from 'lucide-react';
import type { NotificationItem } from '@sd/shared';
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

/** Ключ для сворачивания однотипных уведомлений: без номера заявки и названия техники («Новая задача: Готово: Картридж CF 411, №001116» → «Новая задача: Готово»). */
function groupKey(n: NotificationItem): string {
  // сворачиваем только уведомления по заявкам (в названии номер заявки): разные обычные задачи вместе не склеиваем
  if (!/№\d+/.test(n.title)) return `${n.type}|#${n.id}`;
  const base = n.title.replace(/,?\s*№\d+.*$/, '').replace(/:\s[^:]*$/, '');
  return `${n.type}|${base}`;
}

function groupLabel(n: NotificationItem): string {
  const base = groupKey(n).split('|')[1] ?? n.title;
  return base.startsWith('Новая задача: ') ? `Новые задачи «${base.slice('Новая задача: '.length)}»` : base.replace(/:$/, '');
}

type Row = { kind: 'one'; n: NotificationItem } | { kind: 'group'; key: string; label: string; items: NotificationItem[] };

/** Три и больше подряд однотипных уведомлений (например, «Готово» по десяти картриджам) сворачиваются в одну строку. */
function buildRows(items: NotificationItem[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < items.length) {
    const key = groupKey(items[i]!);
    let j = i + 1;
    while (j < items.length && groupKey(items[j]!) === key) j++;
    if (j - i >= 3)
      rows.push({ kind: 'group', key: `${key}#${items[i]!.id}`, label: groupLabel(items[i]!), items: items.slice(i, j) });
    else for (let k = i; k < j; k++) rows.push({ kind: 'one', n: items[k]! });
    i = j;
  }
  return rows;
}

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
    if (!isRead)
      api
        .post(link ? '/notifications/read' : `/notifications/${id}/read`, link ? { link } : undefined)
        .then(() => inv('notifications'));
    onClose();
    if (link) navigate(link);
  };

  const renderItem = (n: NotificationItem) => (
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
      <button
        type="button"
        className={s.trash}
        aria-label="Удалить уведомление"
        title="Удалить уведомление"
        onClick={() => remove(n.id)}
      >
        <Trash2 size={16} aria-hidden />
      </button>
    </li>
  );

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
      {buildRows(q.data.items).map((row) => {
        if (row.kind === 'one') return renderItem(row.n);
        const open = expanded[row.key];
        const unread = row.items.filter((x) => !x.isRead).length;
        return (
          <li key={row.key} className={s.row} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button
              type="button"
              className={cx(s.item, unread > 0 && s.unread)}
              aria-expanded={Boolean(open)}
              onClick={() => setExpanded((x) => ({ ...x, [row.key]: !x[row.key] }))}
            >
              <span className={s.dot} aria-hidden />
              <span className={s.text}>
                <span className={s.title}>
                  {row.label}: {row.items.length}
                </span>
                <span className={s.body}>
                  {unread > 0 ? `Не прочитано: ${unread}. ` : ''}
                  {open ? 'Нажмите, чтобы свернуть' : 'Нажмите, чтобы развернуть список'}
                </span>
                <time className={s.time}>{fmtWhen(row.items[0]!.createdAt)}</time>
              </span>
              <ChevronDown size={18} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined, flex: 'none' }} />
            </button>
            {open && <ul className={s.list}>{row.items.map(renderItem)}</ul>}
          </li>
        );
      })}
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
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={18} aria-hidden />}
            onClick={clearAll}
            title="Очистить все уведомления"
          >
            {confirmClear ? 'Точно?' : 'Очистить'}
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
