import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, CheckCircle2, X } from 'lucide-react';
import { fmtWhen } from '@/lib/dates';
import { Button } from './Button';
import { Sheet } from './Sheet';
import s from './Toast.module.css';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Уведомление из системы: висит, пока человек сам не закроет. По нажатию открывается полное сообщение. */
  persistent?: boolean;
  createdAt?: string;
  /** Вызывается, когда сообщение открыли (например, отметить прочитанным). */
  onOpen?: () => void;
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Сколько карточек видно стопкой: остальные прячутся за ними и появляются, когда закроют верхние. */
const VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  /** Уведомления из системы: новые сверху. */
  const [deck, setDeck] = useState<ToastItem[]>([]);
  const [open, setOpen] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const navigate = useNavigate();

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const dismissDeck = useCallback((id: number) => setDeck((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = ++seq.current;
      if (t.persistent) {
        setDeck((list) => [{ ...t, id }, ...list].slice(0, 30));
        return;
      }
      setItems((list) => [...list.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 5000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, body) => show({ tone: 'success', title, body }),
      error: (title, body) => show({ tone: 'error', title, body }),
    }),
    [show],
  );

  const openFull = (t: ToastItem) => {
    t.onOpen?.();
    dismissDeck(t.id);
    setOpen(t);
  };

  const shown = deck.slice(0, VISIBLE);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={s.region} aria-live="polite" aria-relevant="additions">
          {deck.length > 0 && (
            <div className={s.deck} data-count={shown.length}>
              {deck.length > 1 && (
                <button type="button" className={s.closeAll} onClick={() => setDeck([])}>
                  Закрыть все ({deck.length})
                </button>
              )}
              <AnimatePresence initial={false}>
                {shown.map((t, i) => (
                  <motion.div
                    key={t.id}
                    className={`${s.toast} ${s.info} ${s.card}`}
                    role="status"
                    aria-hidden={i > 0 ? true : undefined}
                    style={{ zIndex: VISIBLE - i }}
                    initial={{ opacity: 0, y: 24, scale: 0.97 }}
                    animate={{ opacity: i === 0 ? 1 : 0.92, y: -i * 11, scale: 1 - i * 0.045 }}
                    exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                    data-back={i > 0 || undefined}
                  >
                    <Bell className={s.icon} aria-hidden />
                    <button type="button" className={s.content} onClick={() => openFull(t)} tabIndex={i > 0 ? -1 : 0}>
                      <span className={s.title}>{t.title}</span>
                      {t.body && <span className={s.body}>{t.body}</span>}
                    </button>
                    <button
                      type="button"
                      className={`${s.close} ${s.closeCorner}`}
                      aria-label="Закрыть уведомление"
                      onClick={() => dismissDeck(t.id)}
                      tabIndex={i > 0 ? -1 : 0}
                    >
                      <X aria-hidden />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          <AnimatePresence initial={false}>
            {items.map((t) => {
              const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertCircle : Bell;
              return (
                <motion.div
                  key={t.id}
                  layout
                  className={`${s.toast} ${s[t.tone]}`}
                  role={t.tone === 'error' ? 'alert' : 'status'}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <Icon className={s.icon} aria-hidden />
                  <button
                    type="button"
                    className={s.content}
                    onClick={() => {
                      if (t.link) {
                        navigate(t.link);
                        dismiss(t.id);
                      }
                    }}
                    disabled={!t.link}
                  >
                    <span className={s.title}>{t.title}</span>
                    {t.body && <span className={s.body}>{t.body}</span>}
                  </button>
                  <button type="button" className={s.close} aria-label="Скрыть" onClick={() => dismiss(t.id)}>
                    <X aria-hidden />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body,
      )}
      <Sheet
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.title ?? ''}
        subtitle={open?.createdAt ? fmtWhen(open.createdAt) : undefined}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>
              Закрыть
            </Button>
            {open?.link && (
              <Button
                onClick={() => {
                  const to = open.link!;
                  setOpen(null);
                  navigate(to);
                }}
              >
                Открыть
              </Button>
            )}
          </>
        }
      >
        {open?.body ? <p className={s.full}>{open.body}</p> : <p className="muted">Подробностей нет.</p>}
      </Sheet>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast вне ToastProvider');
  return ctx;
}
