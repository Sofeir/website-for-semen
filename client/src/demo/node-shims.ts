// Заглушки node:path и node:url — нужны только верхним строкам серверных файлов, которые в браузере не выполняются.
export const dirname = (p: string) => p.replace(/[/\\][^/\\]*$/, '') || '/';
export const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
export const resolve = (...parts: string[]) => join(...parts);
export const extname = (p: string) => (/\.[^./\\]+$/.exec(p)?.[0] ?? '');
export const fileURLToPath = (u: string | URL) => String(u);
export default { dirname, join, resolve, extname, fileURLToPath };
