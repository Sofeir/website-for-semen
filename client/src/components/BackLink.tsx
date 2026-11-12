import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useBack } from '@/lib/hooks';
import { previousName } from '@/lib/trail';

/**
 * «Назад» всегда возвращает туда, откуда человек пришёл (выезды, поиск, готовая техника, другая заявка).
 * Если страницу открыли по прямой ссылке и истории нет, ссылка ведёт на запасной адрес и называется по нему.
 */
export function BackLink({
  fallback,
  fallbackLabel,
  className,
  children,
}: {
  fallback: string;
  fallbackLabel: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const back = useBack(fallback);
  const name = back.hasHistory ? previousName() : null;
  return (
    <Link
      to={fallback}
      className={className}
      onClick={(e) => {
        // с нажатым Ctrl или Shift это обычная ссылка (новая вкладка)
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        back.goBack();
      }}
    >
      <ArrowLeft size={18} aria-hidden />
      {children ?? (back.hasHistory ? (name ? `Назад к ${name}` : 'Назад') : fallbackLabel)}
    </Link>
  );
}
