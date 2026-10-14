// Демо-модуль тянет серверный код и в обычную проверку типов клиента не входит: описываем только то, что нужно клиенту.
declare module '@/demo/runtime' {
  export const DEMO_PASSWORD: string;
  export const demoEvents: EventTarget;
  export function bootDemo(): Promise<void>;
  export function demoRequest<T>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }>;
  export function resetDemo(): Promise<void>;
  export function installPdfLinks(): void;
}
declare module './demo/runtime' {
  export * from '@/demo/runtime';
}
