import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, CheckCircle2, X } from 'lucide-react';
import s from './Toast.module.css';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  body?: string | null;
  link?: string | null;
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const navigate = useNavigate();

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = ++seq.current;
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

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={s.region} aria-live="polite" aria-relevant="additions">
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
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast вне ToastProvider');
  return ctx;
}
