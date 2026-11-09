import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 767.98px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} — ASOFT Сервис` : 'ASOFT Сервис';
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/**
 * Возврат на тот экран, откуда человек пришёл (готовая техника, задачи, поиск), а не в «общий» список.
 * Если пришли по прямой ссылке и истории нет, остаётся запасной адрес.
 */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  const hasHistory = idx > 0;
  return { hasHistory, goBack: () => (hasHistory ? navigate(-1) : navigate(fallback)) };
}
