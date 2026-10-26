// В обычной (серверной) сборке демо-режима нет: вместо демо-модулей подставляется эта заглушка.
// Обращения к ним в коде закрыты проверкой import.meta.env.VITE_DEMO, поэтому вызываться она не будет.
export const DEMO_PASSWORD = '';
export const demoEvents = new EventTarget();
export const demoViewer: { userId: number | null } = { userId: null };
export async function bootDemo() {}
export function installPdfLinks() {}
export async function resetDemo() {}
export async function demoRequest(): Promise<never> {
  throw new Error('Демо-режим выключен');
}
export async function downloadSqlExport(): Promise<Record<string, number>> {
  return {};
}
