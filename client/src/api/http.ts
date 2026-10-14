export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (import.meta.env.VITE_DEMO) {
    // Демо: сервер работает в браузере, сеть не нужна.
    if (body instanceof FormData) throw new ApiError(501, 'В демо-версии загрузка файлов отключена.');
    const { demoRequest } = await import('@/demo/runtime');
    const r = await demoRequest<any>(method, url, body);
    if (r.status >= 400) {
      if (r.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
      throw new ApiError(r.status, r.data.error || `Ошибка ${r.status}`, r.data.fields || {}, r.data);
    }
    return r.data as T;
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, data.error || `Ошибка ${res.status}`, data.fields || {}, data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: Body) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: Body) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: Body) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Строка запроса без пустых значений. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    s.set(k, String(v === true ? 1 : v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}
