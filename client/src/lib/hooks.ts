import { useEffect, useState } from 'react';

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
