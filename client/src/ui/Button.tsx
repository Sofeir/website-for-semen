import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import s from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'success' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(s.btn, s[variant], size === 'sm' && s.sm, block && s.block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={s.spinner} aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: 'md' | 'sm'; block?: boolean; icon?: ReactNode }) {
  return (
    <Link className={cx(s.btn, s[variant], size === 'sm' && s.sm, block && s.block, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  filled?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, filled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(s.iconBtn, filled && s.iconBtnFilled, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Круглая кнопка «открыть» со стрелкой ↗. */
export function ArrowLink({ to, label, light, className }: { to: string; label: string; light?: boolean; className?: string }) {
  return (
    <Link to={to} aria-label={label} title={label} className={cx(s.arrow, light && s.arrowLight, className)}>
      <ArrowUpRight aria-hidden />
    </Link>
  );
}
