import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Запись') => new HttpError(404, `${what} не найдена`);
export const forbidden = (msg = 'Недостаточно прав для этого действия') => new HttpError(403, msg);

/** Оборачивает async-обработчик, чтобы ошибки попадали в общий errorHandler. */
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data);
}

export function intParam(v: unknown, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Некорректный параметр ${name}`);
  return n;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return res.status(400).json({ error: Object.values(fields)[0] || 'Проверьте поля формы', fields });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  const e = err as { code?: string; message?: string; status?: number; type?: string };
  if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
  if (e?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком большой' });
  if (e?.code === '23505') return res.status(409).json({ error: 'Такая запись уже есть' });
  if (e?.code === '23503') return res.status(409).json({ error: 'Запись связана с другими данными' });
  console.error(err);
  return res.status(500).json({ error: 'Что-то сломалось на сервере. Попробуйте ещё раз.' });
}
