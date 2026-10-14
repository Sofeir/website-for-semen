import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './Button';
import s from './Combobox.module.css';
import f from './Form.module.css';

export interface ComboOption {
  id: number;
  name: string;
}

interface Props {
  options: ComboOption[];
  /** Выбранный id из справочника или null, если введено вручную. */
  valueId: number | null | undefined;
  text: string;
  onChange: (v: { id: number | null; text: string }) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Поле с подсказками из справочника. Можно выбрать вариант или ввести свой. */
export function Combobox({ options, valueId, text, onChange, placeholder, id, disabled, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const display = valueId ? (options.find((o) => o.id === valueId)?.name ?? text) : text;

  const filtered = useMemo(() => {
    const q = display.trim().toLowerCase();
    const list = q && !valueId ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    return list.slice(0, 50);
  }, [options, display, valueId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (o: ComboOption) => {
    onChange({ id: o.id, text: o.name });
    setOpen(false);
  };

  return (
    <div className={s.wrap} ref={wrap}>
      <input
        id={id}
        className={f.control}
        value={display}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && filtered.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        {...aria}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const v = e.target.value;
          const exact = options.find((o) => o.name.toLowerCase() === v.trim().toLowerCase());
          onChange(exact ? { id: exact.id, text: exact.name } : { id: null, text: v });
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && filtered[active]) {
            e.preventDefault();
            pick(filtered[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <ul className={s.list} id={listId} role="listbox">
          {filtered.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === valueId}>
              <button
                type="button"
                tabIndex={-1}
                className={cx(s.option, i === active && s.active, o.id === valueId && s.selected)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
