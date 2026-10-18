import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks';
import { cx } from './Button';
import f from './Form.module.css';
import s from './Select.module.css';

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
}

interface Group {
  label: string | null;
  options: Opt[];
}

interface OptionProps {
  value?: string | number | readonly string[];
  label?: string;
  disabled?: boolean;
  children?: ReactNode;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** Разбирает привычные <option> и <optgroup> в группы для собственного списка. */
function collect(children: ReactNode, groups: Group[], current: Group | null) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as OptionProps;
    if (child.type === Fragment) {
      collect(p.children, groups, current);
    } else if (child.type === 'optgroup') {
      const g: Group = { label: p.label ?? '', options: [] };
      groups.push(g);
      collect(p.children, groups, g);
    } else if (child.type === 'option') {
      const label = textOf(p.children);
      let target = current;
      if (!target) {
        const tail = groups[groups.length - 1];
        if (tail && tail.label === null) target = tail;
        else {
          target = { label: null, options: [] };
          groups.push(target);
        }
      }
      target.options.push({ value: p.value !== undefined ? String(p.value) : label, label, disabled: !!p.disabled });
    }
  });
}

interface Pos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Выпадающий список в стиле приложения. Снаружи ведёт себя как обычный <select>:
 * те же <option>, ref, value, onChange, react-hook-form. Внутри остаётся настоящий
 * скрытый <select> — через него идут значения формы и тесты.
 * На компьютере — всплывающая панель под полем, на телефоне — лист снизу.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, disabled, ...rest },
  ref,
) {
  const mobile = useIsMobile();
  const native = useRef<HTMLSelectElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [pos, setPos] = useState<Pos | null>(null);
  const [active, setActive] = useState(-1);

  const groups: Group[] = [];
  collect(children, groups, null);
  const flat = groups.flatMap((g) => g.options);
  const selected = flat.find((o) => o.value === value);

  const sync = useCallback(() => {
    if (native.current) setValue(native.current.value);
  }, []);

  // react-hook-form и reset() меняют el.value напрямую, без события — ловим присваивание
  const setRef = useCallback(
    (el: HTMLSelectElement | null) => {
      native.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
      if (!el || Object.prototype.hasOwnProperty.call(el, 'value')) return;
      const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (!desc?.get || !desc.set) return;
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: () => desc.get!.call(el),
        set: (v: string) => {
          desc.set!.call(el, v);
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

  const place = useCallback(() => {
    const t = trigger.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const up = below < 220 && above > below;
    const width = Math.max(r.width, 200);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      maxHeight: Math.min(440, Math.max(160, up ? above : below)),
    });
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  const openList = () => {
    if (disabled) return;
    const i = flat.findIndex((o) => o.value === value && !o.disabled);
    setActive(i >= 0 ? i : flat.findIndex((o) => !o.disabled));
    if (!mobile) place();
    setOpen(true);
  };

  const choose = (opt: Opt) => {
    if (opt.disabled) return;
    const el = native.current;
    if (el && el.value !== opt.value) {
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (list.current?.contains(t) || trigger.current?.contains(t)) return;
      setOpen(false);
    };
    const onMove = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      if (mobile) return;
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
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < flat.length; i += step) if (!flat[i].disabled) return i;
    return from;
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => move(a, 1));
    else if (e.key === 'ArrowUp') setActive((a) => move(a, -1));
    else if (e.key === 'Home') setActive(move(-1, 1));
    else if (e.key === 'End') setActive(move(flat.length, -1));
    else if (e.key === 'Enter' || e.key === ' ') {
      if (flat[active]) choose(flat[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(true);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const ch = e.key.toLowerCase();
      const start = active + 1;
      const hit = [...flat.slice(start), ...flat.slice(0, start)].find((o) => !o.disabled && o.label.toLowerCase().startsWith(ch));
      if (hit) setActive(flat.indexOf(hit));
      return;
    } else return;
    e.preventDefault();
  };

  const title = fieldLabel || rest['aria-label'] || '';
  let index = -1;
  const body = groups.map((g, gi) => (
    <div key={gi} role={g.label !== null ? 'group' : undefined} aria-label={g.label || undefined} className={s.group}>
      {g.label ? <div className={s.groupLabel}>{g.label}</div> : null}
      {g.options.map((o) => {
        index += 1;
        const i = index;
        const isSel = o.value === value;
        return (
          <div
            key={`${o.value}-${i}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={isSel}
            aria-disabled={o.disabled || undefined}
            data-active={i === active}
            className={cx(s.option, isSel && s.selected, o.disabled && s.disabled)}
            onMouseMove={() => !o.disabled && i !== active && setActive(i)}
            onClick={() => choose(o)}
          >
            <span className={s.optionText}>{o.label}</span>
            {isSel && <Check aria-hidden />}
          </div>
        );
      })}
    </div>
  ));

  const popup = open
    ? createPortal(
        mobile ? (
          <>
            <div className={s.backdrop} onClick={() => close(true)} />
            <div className={s.sheet}>
              <div className={s.grab} aria-hidden />
              {title && <div className={s.sheetTitle}>{title}</div>}
              <div
                ref={list}
                role="listbox"
                id={listId}
                tabIndex={-1}
                aria-label={title || undefined}
                aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                className={s.list}
                onKeyDown={onListKey}
              >
                {body}
              </div>
            </div>
          </>
        ) : (
          <div
            ref={list}
            role="listbox"
            id={listId}
            tabIndex={-1}
            aria-label={title || undefined}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            className={cx(s.list, s.pop)}
            style={pos ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}
            onKeyDown={onListKey}
          >
            {body}
          </div>
        ),
        document.body,
      )
    : null;

  return (
    <div className={s.wrap}>
      <select
        ref={setRef}
        {...rest}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className={s.native}
        onFocus={(e) => {
          rest.onFocus?.(e);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        {children}
      </select>
      <button
        ref={trigger}
        type="button"
        className={cx(f.control, s.trigger, className)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={rest['aria-invalid']}
        aria-describedby={rest['aria-describedby']}
        aria-label={title ? `${title}: ${selected?.label ?? ''}` : undefined}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) openList();
          }
        }}
      >
        <span className={s.value}>{selected?.label ?? ''}</span>
        <ChevronDown aria-hidden className={cx(s.chevron, open && s.chevronOpen)} />
      </button>
      {popup}
    </div>
  );
});
