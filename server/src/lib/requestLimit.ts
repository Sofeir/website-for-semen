import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { HttpError } from './http';

/**
 * Ограничитель частоты запросов в памяти: не больше `max` запросов за `windowMs` на одного человека.
 * Вошедшего считаем по сотруднику (офис выходит в сеть с одного адреса), остальных по адресу.
 * Нужен против перебора и «заваливания» сервера; обычной работе не мешает.
 */
export function createLimiter(opts: { windowMs: number; max: number; name?: string }) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  const sweep = (now: number) => {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [k, list] of hits) {
      const fresh = list.filter((t) => now - t < opts.windowMs);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  };

  /** Сколько секунд ждать; 0 — запрос можно выполнять (и он засчитан). */
  const take = (key: string): number => {
    const now = Date.now();
    sweep(now);
    const list = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (list.length >= opts.max) {
      hits.set(key, list);
      return Math.max(1, Math.ceil((list[0]! + opts.windowMs - now) / 1000));
    }
    list.push(now);
    hits.set(key, list);
    return 0;
  };

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!config.rateLimit) return next();
    const key = req.user ? `u${req.user.id}` : `ip${req.ip || 'unknown'}`;
    const wait = take(key);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return next(new HttpError(429, 'Слишком много запросов. Подождите минуту и повторите.'));
    }
    next();
  };

  return Object.assign(middleware, { take, reset: () => hits.clear() });
}
