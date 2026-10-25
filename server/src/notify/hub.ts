import type { Response } from 'express';

/** Открытые SSE-соединения по пользователям (вкладок может быть несколько). */
const subscribers = new Map<number, Set<Response>>();

export function subscribe(userId: number, res: Response) {
  let set = subscribers.get(userId);
  if (!set) subscribers.set(userId, (set = new Set()));
  set.add(res);
  return () => {
    set!.delete(res);
    if (!set!.size) subscribers.delete(userId);
  };
}

function write(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Возвращает, скольким открытым вкладкам человека событие ушло. Ноль — его сейчас нет на сайте. */
export function sendTo(userId: number, event: string, data: unknown) {
  const set = subscribers.get(userId);
  for (const res of set ?? []) write(res, event, data);
  return set?.size ?? 0;
}

/** Всем подключённым: «данные изменились, обновите списки». */
export function broadcast(event: string, data: unknown) {
  for (const set of subscribers.values()) for (const res of set) write(res, event, data);
}

export function connectedCount() {
  let n = 0;
  for (const set of subscribers.values()) n += set.size;
  return n;
}
