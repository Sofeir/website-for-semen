import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  cloneElement,
  isValidElement,
  type ReactElement,
} from 'react';
import { motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './Button';
import s from './Form.module.css';

export const formStyles = s;

interface FieldProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  /** Контрол или функция, которая получает id и aria-атрибуты (для Controller и составных полей). */
  children: ReactElement | ((control: ControlProps) => ReactElement);
  /** Если внутри не один контрол, а группа — подпись не связывается с id. */
  group?: boolean;
}

export interface ControlProps {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Подпись + контрол + подсказка/ошибка. id и aria-* проставляются сами. */
export function Field({ label, error, hint, optional, className, children, group }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const controlProps: ControlProps = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy };
  let controlId = id;
  let child: ReactNode;
  if (typeof children === 'function') child = children(controlProps);
  else if (isValidElement(children)) {
    controlId = (children.props as any).id ?? id;
    child = cloneElement(children as ReactElement<any>, { ...controlProps, id: controlId });
  } else child = children;
  const Label = group ? 'span' : 'label';
  return (
    <div
      className={cx(s.field, className)}
      role={group ? 'group' : undefined}
      aria-labelledby={group ? `${id}-label` : undefined}
    >
      <Label className={s.label} id={`${id}-label`} {...(!group ? { htmlFor: controlId } : {})}>
        {label}
        {optional && <span className={s.optional}> — необязательно</span>}
      </Label>
      {child}
      {error ? (
        <span className={s.error} id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className={s.hint} id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; trailing?: ReactNode }
>(function Input({ className, icon, trailing, ...rest }, ref) {
  const input = <input ref={ref} className={cx(s.control, className, trailing ? s.withTrailing : undefined)} {...rest} />;
  if (!icon && !trailing) return input;
  return (
    <div className={cx(Boolean(icon) && s.inputIcon, Boolean(trailing) && s.inputTrail)}>
      {icon}
      {input}
      {trailing && <span className={s.trailing}>{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(s.control, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={s.selectWrap}>
      <select ref={ref} className={cx(s.control, className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden />
    </div>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(
  function Checkbox({ label, className, ...rest }, ref) {
    return (
      <label className={cx(s.check, className)}>
        <input ref={ref} type="checkbox" {...rest} />
        <span>{label}</span>
      </label>
    );
  },
);

/** Группа крупных чипов с множественным выбором. */
export function ChipGroup({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <div className={s.chips} role="group" aria-label={label}>
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <label key={opt} className={cx(s.chip, on && s.chipOn)}>
            <input type="checkbox" checked={on} onChange={() => toggle(opt)} />
            <span className={s.chipMark} aria-hidden>
              <Check strokeWidth={3} />
            </span>
            {opt}
          </label>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
  layoutId,
}: {
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
  layoutId: string;
}) {
  return (
    <div className={cx(s.segmented, block && s.block)} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={cx(s.segment, active && s.segmentActive)}
            onClick={() => onChange(o.value)}
          >
            {active && (
              <motion.span layoutId={layoutId} className={s.segmentBg} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }} />
            )}
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Одиночный выбор крупными чипами (например, тип техники). */
export function RadioChips({
  options,
  value,
  onChange,
  label,
  invalid,
}: {
  options: { id: number; name: string }[];
  value: number | null | undefined;
  onChange: (id: number) => void;
  label: string;
  invalid?: boolean;
}) {
  // Своё имя группы: на странице может быть несколько одинаковых групп (несколько единиц техники).
  const name = useId();
  return (
    <div className={cx(s.chips, invalid && s.chipsInvalid)} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <label key={o.id} className={cx(s.chip, on && s.chipOn)}>
            <input type="radio" checked={on} onChange={() => onChange(o.id)} name={name} />
            {o.name}
          </label>
        );
      })}
    </div>
  );
}
