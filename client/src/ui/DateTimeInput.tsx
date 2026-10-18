import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks';
import { cx } from './Button';
import f from './Form.module.css';
import s from './DateTimeInput.module.css';

export type PickerKind = 'datetime-local' | 'date' | 'time';

interface Parts {
  y: number;
  m: number; // 0–11
  d: number;
  h: number;
  mi: number;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const p2 = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`;

function parse(kind: PickerKind, v: string | undefined): Parts | null {
  if (!v) return null;
  const date = /(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const time = /(\d{2}):(\d{2})/.exec(kind === 'time' ? v : (v.split('T')[1] ?? ''));
  if (kind !== 'time' && !date) return null;
  if (kind !== 'date' && !time) return null;
  return {
    y: date ? Number(date[1]) : 0,
    m: date ? Number(date[2]) - 1 : 0,
    d: date ? Number(date[3]) : 1,
    h: time ? Number(time[1]) : 0,
    mi: time ? Number(time[2]) : 0,
  };
}

function format(kind: PickerKind, p: Parts): string {
  if (kind === 'time') return `${p2(p.h)}:${p2(p.mi)}`;
  if (kind === 'date') return ymd(p.y, p.m, p.d);
  return `${ymd(p.y, p.m, p.d)}T${p2(p.h)}:${p2(p.mi)}`;
}

function display(kind: PickerKind, p: Parts): string {
  if (kind === 'time') return `${p2(p.h)}:${p2(p.mi)}`;
  const day = `${p2(p.d)}.${p2(p.m + 1)}.${p.y}`;
  return kind === 'date' ? day : `${day}, ${p2(p.h)}:${p2(p.mi)}`;
}

const PLACEHOLDER: Record<PickerKind, string> = {
  'datetime-local': 'Выберите дату и время',
  date: 'Выберите дату',
  time: 'Выберите время',
};

interface Pos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const WRAPPED = Symbol('pickerWrapped');
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/**
 * Поле даты и времени в стиле приложения вместо встроенного календаря браузера.
 * Снаружи это обычный <input type="date | time | datetime-local">: те же value, onChange, ref,
 * react-hook-form. Внутри остаётся настоящий скрытый input — через него идут значения формы.
 */
export const DateTimeInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { type: PickerKind }>(
  function DateTimeInput({ type: kind, className, disabled, placeholder, step, min, max, ...rest }, ref) {
    const mobile = useIsMobile();
    const native = useRef<HTMLInputElement | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const [fieldLabel, setFieldLabel] = useState('');
    const [pos, setPos] = useState<Pos | null>(null);
    const [view, setView] = useState({ y: 0, m: 0 });
    const [focusDay, setFocusDay] = useState<string | null>(null);

    const sync = useCallback(() => {
      if (native.current) setValue(native.current.value);
    }, []);

    // react-hook-form и reset() присваивают el.value напрямую — ловим присваивание, не ломая учёт значений в React
    const setRef = useCallback(
      (el: HTMLInputElement | null) => {
        native.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
        if (!el || (el as unknown as Record<symbol, boolean>)[WRAPPED]) return;
        const own = Object.getOwnPropertyDescriptor(el, 'value') ?? nativeValue;
        if (!own?.get || !own.set) return;
        (el as unknown as Record<symbol, boolean>)[WRAPPED] = true;
        Object.defineProperty(el, 'value', {
          configurable: true,
          get: () => own.get!.call(el),
          set: (v: string) => {
            own.set!.call(el, v);
            sync();
          },
        });
      },
      [ref, sync],
    );

    useLayoutEffect(() => {
      sync();
      const labels = native.current?.labels;
      setFieldLabel(labels && labels.length ? (labels[0].textContent ?? '').trim() : '');
    });

    const parts = parse(kind, value);
    const minDay = min ? String(min).slice(0, 10) : '';
    const maxDay = max ? String(max).slice(0, 10) : '';
    const minuteStep = Math.min(30, Math.max(1, step ? Math.round(Number(step) / 60) : 5));

    const place = useCallback(() => {
      const t = trigger.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 14;
      const above = r.top - 14;
      const up = below < 400 && above > below;
      const want = kind === 'datetime-local' ? 580 : kind === 'time' ? 280 : 320;
      const width = Math.min(want, window.innerWidth - 16);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
        top: up ? undefined : r.bottom + 6,
        bottom: up ? window.innerHeight - r.top + 6 : undefined,
        maxHeight: Math.max(240, up ? above : below),
      });
    }, [kind]);

    const close = useCallback((returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) trigger.current?.focus({ preventScroll: true });
    }, []);

    const openPanel = () => {
      if (disabled) return;
      const now = new Date();
      const base = parts ?? { y: now.getFullYear(), m: now.getMonth(), d: now.getDate(), h: 0, mi: 0 };
      setView({ y: base.y, m: base.m });
      setFocusDay(null);
      if (!mobile) place();
      setOpen(true);
    };

    const commit = (next: string) => {
      const el = native.current;
      if (!el || el.value === next) return;
      // родной сеттер в обход учёта значений в React, иначе onChange не сработает
      nativeValue?.set?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    };

    useEffect(() => {
      if (!open) return;
      panel.current?.focus({ preventScroll: true });
      const onDown = (e: PointerEvent) => {
        const t = e.target as Node;
        if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
        setOpen(false);
      };
      const onMove = (e: Event) => {
        if (mobile || panel.current?.contains(e.target as Node)) return;
        place();
      };
      document.addEventListener('pointerdown', onDown);
      window.addEventListener('resize', onMove);
      window.addEventListener('scroll', onMove, true);
      const prevOverflow = document.body.style.overflow;
      if (mobile) document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('pointerdown', onDown);
        window.removeEventListener('resize', onMove);
        window.removeEventListener('scroll', onMove, true);
        if (mobile) document.body.style.overflow = prevOverflow;
      };
    }, [open, mobile, place]);

    useEffect(() => {
      if (open && focusDay) panel.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
    }, [open, focusDay, view]);

    const today = new Date();
    const todayKey = ymd(today.getFullYear(), today.getMonth(), today.getDate());
    const selectedKey = parts && kind !== 'time' ? ymd(parts.y, parts.m, parts.d) : '';

    const baseParts = (): Parts => parts ?? { y: today.getFullYear(), m: today.getMonth(), d: today.getDate(), h: 9, mi: 0 };

    const pickDay = (y: number, m: number, d: number) => {
      const t = parts ?? { ...baseParts(), h: 9, mi: 0 };
      commit(format(kind, { ...t, y, m, d }));
      setView({ y, m });
      if (kind === 'date') close(true);
    };

    const pickTime = (h: number | null, mi: number | null) => {
      const t = baseParts();
      commit(format(kind, { ...t, h: h ?? t.h, mi: mi ?? (parts ? t.mi : 0) }));
    };

    const shiftMonth = (delta: number) => {
      const d = new Date(view.y, view.m + delta, 1);
      setView({ y: d.getFullYear(), m: d.getMonth() });
    };

    const monthTitle = (() => {
      const t = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(view.y, view.m, 1));
      return t.charAt(0).toUpperCase() + t.slice(1).replace(' г.', '');
    })();

    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const cells = Array.from({ length: 42 }, (_, i) => new Date(view.y, view.m, 1 - offset + i));
    const rows = cells.slice(35).every((c) => c.getMonth() !== view.m) ? cells.slice(0, 35) : cells;

    const wanted = focusDay ?? (selectedKey || todayKey);
    const tabKey = rows.some((c) => ymd(c.getFullYear(), c.getMonth(), c.getDate()) === wanted) ? wanted : ymd(view.y, view.m, 1);

    const onDayKey = (e: KeyboardEvent<HTMLButtonElement>, date: Date) => {
      const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(e.key in step)) return;
      e.preventDefault();
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + step[e.key]);
      setView({ y: next.getFullYear(), m: next.getMonth() });
      setFocusDay(ymd(next.getFullYear(), next.getMonth(), next.getDate()));
    };

    const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab' && !panel.current?.contains(document.activeElement)) {
        close(true);
      }
    };

    const title = fieldLabel || rest['aria-label'] || '';
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep).filter((m) => m < 60);
    const canClear = kind !== 'time' && !rest.required;

    const body = (
      <>
        <div className={s.cols}>
          {kind !== 'time' && (
            <div className={s.cal}>
              <div className={s.calHead}>
                <button type="button" className={s.nav} aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft aria-hidden />
                </button>
                <b className={s.month} aria-live="polite">
                  {monthTitle}
                </b>
                <button type="button" className={s.nav} aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>
                  <ChevronRight aria-hidden />
                </button>
              </div>
              <div className={s.weekdays} aria-hidden>
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className={s.days} role="grid" aria-label={monthTitle}>
                {rows.map((c) => {
                  const key = ymd(c.getFullYear(), c.getMonth(), c.getDate());
                  const out = c.getMonth() !== view.m;
                  const off = Boolean((minDay && key < minDay) || (maxDay && key > maxDay));
                  return (
                    <button
                      key={key}
                      type="button"
                      role="gridcell"
                      data-day={key}
                      disabled={off}
                      aria-selected={key === selectedKey}
                      aria-current={key === todayKey ? 'date' : undefined}
                      tabIndex={key === tabKey ? 0 : -1}
                      className={cx(s.day, out && s.out, key === todayKey && s.today, key === selectedKey && s.selected)}
                      onClick={() => pickDay(c.getFullYear(), c.getMonth(), c.getDate())}
                      onKeyDown={(e) => onDayKey(e, c)}
                    >
                      {c.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {kind !== 'date' && (
            <div className={s.time}>
              <div className={s.timeLabel}>Часы</div>
              <div className={s.hours}>
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={cx(s.cell, parts?.h === h && s.selected)}
                    aria-pressed={parts?.h === h}
                    onClick={() => pickTime(h, null)}
                  >
                    {p2(h)}
                  </button>
                ))}
              </div>
              <div className={s.timeLabel}>Минуты</div>
              <div className={s.minutes}>
                {minutes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={cx(s.cell, parts?.mi === m && s.selected)}
                    aria-pressed={parts?.mi === m}
                    onClick={() => pickTime(null, m)}
                  >
                    {p2(m)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className={s.foot}>
          <div className={s.footLeft}>
            {kind !== 'time' && (
              <button
                type="button"
                className={s.link}
                onClick={() => pickDay(today.getFullYear(), today.getMonth(), today.getDate())}
              >
                Сегодня
              </button>
            )}
            {canClear && value && (
              <button
                type="button"
                className={cx(s.link, s.linkMuted)}
                onClick={() => {
                  commit('');
                  close(true);
                }}
              >
                Очистить
              </button>
            )}
          </div>
          {kind !== 'date' && (
            <button type="button" className={s.done} onClick={() => close(true)}>
              Готово
            </button>
          )}
        </div>
      </>
    );

    const popup = open
      ? createPortal(
          mobile ? (
            <>
              <div className={s.backdrop} onClick={() => close(true)} />
              <div className={s.sheet}>
                <div className={s.grab} aria-hidden />
                {title && <div className={s.sheetTitle}>{title}</div>}
                <div
                  ref={panel}
                  id={panelId}
                  role="dialog"
                  aria-label={title || undefined}
                  tabIndex={-1}
                  className={s.body}
                  onKeyDown={onPanelKey}
                >
                  {body}
                </div>
              </div>
            </>
          ) : (
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-label={title || undefined}
              tabIndex={-1}
              className={cx(s.pop, s.body)}
              style={
                pos
                  ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }
                  : { visibility: 'hidden' }
              }
              onKeyDown={onPanelKey}
            >
              {body}
            </div>
          ),
          document.body,
        )
      : null;

    const Icon = kind === 'time' ? Clock : CalendarDays;

    return (
      <div className={s.wrap}>
        <input
          ref={setRef}
          {...rest}
          type={kind}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden
          className={s.native}
          onFocus={(e) => {
            rest.onFocus?.(e);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
        <button
          ref={trigger}
          type="button"
          className={cx(f.control, s.trigger, className)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-invalid={rest['aria-invalid']}
          aria-describedby={rest['aria-describedby']}
          aria-label={title ? `${title}: ${parts ? display(kind, parts) : 'не выбрано'}` : undefined}
          onClick={() => (open ? close(false) : openPanel())}
        >
          <span className={cx(s.value, !parts && s.placeholder)}>
            {parts ? display(kind, parts) : (placeholder ?? PLACEHOLDER[kind])}
          </span>
          <Icon aria-hidden className={s.icon} />
        </button>
        {popup}
      </div>
    );
  },
);
