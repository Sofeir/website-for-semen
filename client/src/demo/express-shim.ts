// Мини-замена Express для демо: маршруты, middleware и объекты req/res в памяти браузера.
type Next = (err?: unknown) => void;
type Handler = (req: any, res: any, next: Next) => unknown;
type ErrHandler = (err: unknown, req: any, res: any, next: Next) => unknown;

interface Layer {
  method?: string;
  re: RegExp;
  keys: string[];
  prefix: boolean;
  handlers: (Handler | RouterImpl)[];
}

function compile(path: string, prefix: boolean) {
  const keys: string[] = [];
  const src = path
    .replace(/\/+$/, '')
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([a-zA-Z_]\w*)/g, (_m, k) => {
      keys.push(k);
      return '([^/]+)';
    });
  return { re: new RegExp('^' + src + (prefix ? '(?=/|$)' : '/?$')), keys };
}

class RouterImpl {
  layers: Layer[] = [];

  use(...args: any[]) {
    let path = '';
    if (typeof args[0] === 'string') path = args.shift();
    const { re, keys } = compile(path, true);
    this.layers.push({ re, keys, prefix: true, handlers: args.flat() });
    return this;
  }

  private add(method: string, path: string, handlers: any[]) {
    const { re, keys } = compile(path, false);
    this.layers.push({ method, re, keys, prefix: false, handlers: handlers.flat() });
    return this;
  }
  get = (p: string, ...h: any[]) => this.add('GET', p, h);
  post = (p: string, ...h: any[]) => this.add('POST', p, h);
  put = (p: string, ...h: any[]) => this.add('PUT', p, h);
  patch = (p: string, ...h: any[]) => this.add('PATCH', p, h);
  delete = (p: string, ...h: any[]) => this.add('DELETE', p, h);

  /** Прогоняет запрос по слоям. `url` — путь относительно текущего роутера. */
  handle(req: any, res: any, done: Next, url: string = req.path) {
    let i = 0;
    const nextLayer: Next = (err) => {
      if (err) return done(err);
      while (i < this.layers.length) {
        const layer = this.layers[i++];
        if (layer.method && layer.method !== req.method) continue;
        const m = layer.re.exec(url);
        if (!m) continue;
        const saved = req.params;
        req.params = { ...saved };
        layer.keys.forEach((k, idx) => (req.params[k] = decodeURIComponent(m[idx + 1])));
        const rest = layer.prefix ? url.slice(m[0].length) || '/' : url;
        let j = 0;
        const nextHandler: Next = (e) => {
          if (e) return done(e);
          const hd = layer.handlers[j++];
          if (!hd) {
            req.params = saved;
            return nextLayer();
          }
          try {
            if (hd instanceof RouterImpl) return hd.handle(req, res, nextHandler, rest);
            const r = (hd as Handler)(req, res, nextHandler);
            if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(nextHandler);
          } catch (ex) {
            nextHandler(ex);
          }
        };
        return nextHandler();
      }
      done();
    };
    nextLayer();
  }
}

export function Router() {
  return new RouterImpl();
}

export interface DemoResult {
  status: number;
  data: unknown;
}

/** Выполняет запрос через собранное приложение и возвращает ответ, как fetch. */
export function dispatch(
  app: RouterImpl,
  onError: ErrHandler,
  input: { method: string; url: string; body?: unknown },
): Promise<DemoResult> {
  const u = new URL(input.url, 'http://demo.local');
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (query[k] = v));
  const req: any = {
    method: input.method.toUpperCase(),
    path: u.pathname,
    url: u.pathname + u.search,
    query,
    params: {},
    body: input.body ?? {},
    cookies: {},
    ip: 'demo',
    get: () => undefined,
    on: () => {},
  };
  return new Promise<DemoResult>((resolve) => {
    let status = 200;
    let sent = false;
    const finish = (data: unknown) => {
      if (sent) return;
      sent = true;
      resolve({ status, data });
    };
    const res: any = {
      status(c: number) {
        status = c;
        return res;
      },
      set: () => res,
      json(d: unknown) {
        finish(d);
        return res;
      },
      send: (d: unknown) => finish(d),
      end: (d?: unknown) => finish(d),
      write: () => true,
      flushHeaders: () => {},
      cookie: () => res,
      clearCookie: () => res,
    };
    const fail = (err: unknown) => onError(err, req, res, () => {});
    app.handle(req, res, (err) => (err ? fail(err) : (status = 404, finish({ error: 'Нет такого адреса API' }))), req.path);
  });
}

const express = { Router, json: () => (_q: any, _r: any, n: Next) => n() };
export default express;
export type Request = any;
export type Response = any;
export type NextFunction = Next;
export type RequestHandler = Handler;
