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

const ROW = 40;
const PAD = 80; // два пустых ряда сверху и снизу, чтобы крайние значения тоже вставали в центр

/**
 * Колесо выбора, как при установке будильника. Управление своё, без прокрутки браузера:
 *  — колесо мыши: один щелчок равен одной строке, при быстром вращении строки идут без пропусков;
 *    тачпад: мелкие движения копятся и дают строку на каждые ~40 пикселей;
 *  — палец и перетаскивание мышью: строки идут за пальцем, после отпускания колесо докатывается до ближайшей строки;
 *  — тап или клик по строке выбирает её; стрелки вверх и вниз работают с клавиатуры.
 * Значение записывается сразу, а не после остановки.
 */
function Wheel({
  items,
  value,
  initial,
  label,
  onPick,
}: {
  items: number[];
  value: number | null;
  initial: number;
  label: string;
  onPick: (v: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pos = useRef(0);
  const raf = useRef(0);
  const drag = useRef<{ y: number; start: number; moved: boolean; t: number; v: number } | null>(null);
  /** Куда уже «доехало» колесо: при быстром вращении события приходят чаще, чем обновляется значение. */
  const virt = useRef(0);
  const wheelAcc = useRef(0);
  const max = (items.length - 1) * ROW;
  const clamp = useCallback((n: number) => Math.max(0, Math.min(max, n)), [max]);

  const shown = value ?? initial;
  const index = Math.max(0, items.indexOf(shown));
  const indexRef = useRef(index);
  indexRef.current = index;
  const valueRef = useRef(value);
  valueRef.current = value;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const setPos = useCallback((n: number) => {
    pos.current = n;
    if (box.current) box.current.scrollTop = n;
  }, []);

  const glide = useCallback(
    (to: number) => {
      cancelAnimationFrame(raf.current);
      const from = pos.current;
      if (Math.abs(to - from) < 0.5) return setPos(to);
      const t0 = performance.now();
      const dur = Math.min(260, 120 + Math.abs(to - from) * 0.8);
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setPos(from + (to - from) * e);
        if (k < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    },
    [setPos],
  );

  const choose = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(itemsRef.current.length - 1, i));
      glide(n * ROW);
      if (itemsRef.current[n] !== valueRef.current) onPickRef.current(itemsRef.current[n]);
    },
    [glide],
  );

  // при открытии и при внешней смене значения ставим колесо на нужную строку
  useLayoutEffect(() => {
    virt.current = index;
    if (drag.current) return;
    if (Math.abs(pos.current - index * ROW) > 0.5) setPos(index * ROW);
  }, [index, setPos]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // колесо мыши: нативный слушатель, чтобы можно было отменить прокрутку страницы
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dy = e.deltaMode === 0 ? e.deltaY : e.deltaY * ROW;
      let steps: number;
      if (e.deltaMode !== 0 || Math.abs(dy) >= 50) {
        // щелчок колеса мыши: ровно одна строка на событие, как бы быстро ни крутили
        steps = dy > 0 ? 1 : -1;
        wheelAcc.current = 0;
      } else {
        // тачпад: мелкие движения копим
        wheelAcc.current += dy;
        steps = Math.trunc(wheelAcc.current / 40);
        wheelAcc.current -= steps * 40;
      }
      if (!steps) return;
      virt.current = Math.max(0, Math.min(itemsRef.current.length - 1, virt.current + steps));
      choose(virt.current);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [choose]);

  const itemAt = (clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    pos.current = box.current!.scrollTop;
    return Math.floor((clientY - r.top + pos.current - PAD) / ROW);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    if (box.current) pos.current = box.current.scrollTop;
    box.current?.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: pos.current, moved: false, t: performance.now(), v: 0 };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 5) return;
    d.moved = true;
    const now = performance.now();
    const next = clamp(d.start - dy);
    d.v = (next - pos.current) / Math.max(1, now - d.t); // px/мс, куда едет колесо
    d.t = now;
    setPos(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      const i = itemAt(e.clientY);
      if (i >= 0 && i < items.length) choose(i);
      return;
    }
    const fresh = performance.now() - d.t < 90; // палец остановился перед отпусканием — без инерции
    const target = pos.current + (fresh && Math.abs(d.v) > 0.5 ? d.v * 90 : 0);
    const i = Math.round(clamp(target) / ROW);
    // за один бросок — не больше пяти строк от места, где отпустили
    const from = Math.round(pos.current / ROW);
    choose(Math.max(from - 5, Math.min(from + 5, i)));
  };

  return (
    <div className={s.wheelWrap}>
      <div className={s.wheelBand} aria-hidden />
      <div
        ref={box}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        data-native-scroll
        className={s.wheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          choose(index);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            choose(index + 1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            choose(index - 1);
          }
        }}
      >
        {items.map((v) => (
          <div key={v} role="option" aria-selected={v === value} className={cx(s.wheelItem, v === value && s.wheelOn)}>
            {p2(v)}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    const minuteStep = Math.min(30, Math.max(1, step ? Math.round(Number(step) / 60) : 1));

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
    const minuteItems = parts && !minutes.includes(parts.mi) ? [...minutes, parts.mi].sort((x, y) => x - y) : minutes;
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
              <div className={s.wheels}>
                <div className={s.timeLabel}>Часы</div>
                <span />
                <div className={s.timeLabel}>Минуты</div>
                <Wheel label="Часы" items={hours} value={parts?.h ?? null} initial={9} onPick={(h) => pickTime(h, null)} />
                <span className={s.colon} aria-hidden>
                  :
                </span>
                <Wheel
                  label="Минуты"
                  items={minuteItems}
                  value={parts?.mi ?? null}
                  initial={0}
                  onPick={(m) => pickTime(null, m)}
                />
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
