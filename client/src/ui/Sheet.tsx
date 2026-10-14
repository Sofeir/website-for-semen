import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useIsMobile, useReducedMotion } from '@/lib/hooks';
import { IconButton, cx } from './Button';
import s from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** На телефоне — лист на весь экран (для длинных форм). */
  full?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Модальное окно: по центру на компьютере, лист снизу на телефоне. */
export function Sheet({ open, onClose, title, subtitle, children, footer, width = 560, full }: SheetProps) {
  const mobile = useIsMobile();
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
      first?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const offset = reduced ? {} : mobile ? { y: '100%' } : { y: 12, scale: 0.98 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={s.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            className={cx(s.panel, full && s.full)}
            style={{ ['--sheet-w' as string]: `${width}px` }}
            initial={{ opacity: mobile ? 1 : 0, ...offset }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: mobile ? 1 : 0, ...offset }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className={s.grabber} aria-hidden />
            <div className={s.head}>
              <div className={s.title}>
                {title}
                {subtitle && <div className={s.subtitle}>{subtitle}</div>}
              </div>
              <IconButton label="Закрыть окно" onClick={onClose}>
                <X />
              </IconButton>
            </div>
            <div className={s.body}>{children}</div>
            {footer && <div className={s.foot}>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
