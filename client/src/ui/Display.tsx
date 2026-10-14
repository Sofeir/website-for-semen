import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { ApiError } from '@/api/http';
import { cx } from './Button';
import s from './Display.module.css';

export const displayStyles = s;

export function Card({ className, pad = true, ...rest }: HTMLAttributes<HTMLDivElement> & { pad?: boolean }) {
  return <div className={cx(s.card, pad && s.pad, className)} {...rest} />;
}

export function CardHead({ title, count, children }: { title: ReactNode; count?: number; children?: ReactNode }) {
  return (
    <div className={s.cardHead}>
      <h2 className={s.cardTitle}>
        {title}
        {count !== undefined && <span className={s.cardCount}>{count}</span>}
      </h2>
      {children}
    </div>
  );
}

export function Plate({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(s.plate, className)} {...rest} />;
}

export type Tone = 'neutral' | 'outline' | 'blue' | 'sky' | 'teal' | 'amber' | 'red' | 'violet' | 'slate' | 'dark';

export function Pill({
  tone = 'neutral',
  dot,
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone | string;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cx(s.pill, s[tone] ?? s.neutral, className)} title={title}>
      {dot && <span className={s.dot} aria-hidden />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function StagePill({ name, color }: { name: string; color: string }) {
  return (
    <Pill tone={color} dot>
      {name}
    </Pill>
  );
}

export function NumberTag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.num, className)}>{children}</span>;
}

export function Avatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span className={s.avatar} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {initials || '?'}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>{icon}</div>
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Загружаем' }: { label?: string }) {
  return (
    <div className={s.spinnerWrap} role="status">
      <span className={s.spinner} aria-hidden />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function Skeleton({ h = 20, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className={s.skeleton} style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function ErrorBox({ error, children }: { error?: unknown; children?: ReactNode }) {
  const msg = children ?? (error instanceof ApiError || error instanceof Error ? error.message : 'Не удалось загрузить данные');
  return (
    <div className={s.errorBox} role="alert">
      <AlertTriangle aria-hidden />
      <div>{msg}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={s.pageHead}>
      <div className={s.pageTitleWrap}>
        <h1 className={s.pageTitle}>{title}</h1>
        {subtitle && <p className={s.pageSub}>{subtitle}</p>}
      </div>
      {actions && <div className={s.pageActions}>{actions}</div>}
    </header>
  );
}

export function Accordion({
  title,
  meta,
  defaultOpen = false,
  children,
  leading,
}: {
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  leading?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.acc}>
      <button type="button" className={cx(s.accHead, open && s.accOpen)} aria-expanded={open} onClick={() => setOpen(!open)}>
        {leading}
        <span className={s.accTitle}>{title}</span>
        {meta && <span className={s.accMeta}>{meta}</span>}
        <ChevronDown aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={s.accBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className={s.accInner}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={s.tabs} role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={it.value === value}
          className={cx(s.tab, it.value === value && s.tabActive)}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count !== undefined && <span className={s.tabCount}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function DescList({ items }: { items: [ReactNode, ReactNode][] }) {
  const rows = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  return (
    <dl className={s.dl}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
