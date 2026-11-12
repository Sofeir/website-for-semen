import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Куда человек придёт по кнопке «Назад»: запоминаем адрес каждого шага истории браузера
 * (у каждого шага свой номер idx), чтобы подписать кнопку: «Назад к выездам», «Назад к заявке».
 */
const trail = new Map<number, string>();

const idxNow = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;

/** Один раз в оболочке приложения: записывает адрес текущего шага. */
export function useTrail() {
  const { pathname } = useLocation();
  useEffect(() => {
    trail.set(idxNow(), pathname);
  }, [pathname]);
}

const NAMES: [RegExp, string][] = [
  [/^\/$/, 'главной'],
  [/^\/orders\/[^/]+$/, 'заявке'],
  [/^\/orders$/, 'заявкам'],
  [/^\/intake/, 'приёму техники'],
  [/^\/clients\/[^/]+$/, 'клиенту'],
  [/^\/clients$/, 'клиентам'],
  [/^\/ready/, 'готовой технике'],
  [/^\/tasks/, 'задачам'],
  [/^\/calendar/, 'календарю'],
  [/^\/visits/, 'выездам'],
  [/^\/plan/, 'плану месяца'],
  [/^\/reports\/service/, 'журналу выездов'],
  [/^\/reports/, 'отчётам'],
  [/^\/analytics/, 'аналитике'],
  [/^\/acts\/[^/]+$/, 'акту'],
  [/^\/acts/, 'актам'],
  [/^\/settings/, 'настройкам'],
  [/^\/profile/, 'профилю'],
];

/** Подпись кнопки «Назад» по тому, куда она ведёт; null, если предыдущий шаг неизвестен. */
export function previousName(): string | null {
  const idx = idxNow();
  const prev = idx > 0 ? trail.get(idx - 1) : undefined;
  if (!prev) return null;
  return NAMES.find(([re]) => re.test(prev))?.[1] ?? null;
}
