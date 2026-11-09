import { api } from '@/api/http';

/** off: можно включить; on: устройство подписано; denied: запрещено в браузере; install: на iPhone сначала нужно добавить сайт на экран «Домой». */
export type PushState = 'unsupported' | 'install' | 'denied' | 'off' | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function supported() {
  return (
    !import.meta.env.VITE_DEMO &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyToBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Просит разрешение (только по нажатию кнопки), подписывает устройство и сообщает серверу. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const { publicKey } = await api.get<{ publicKey: string }>('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api.post('/push/subscribe', sub.toJSON() as any);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

/** Если разрешение уже выдано, а сервер о подписке забыл (сменили пользователя, очистили базу), подписываем заново без вопросов. */
export async function syncPush() {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) await api.post('/push/subscribe', sub.toJSON() as any);
  } catch {
    // не получилось — повторим при следующем входе
  }
}

/** Число на значке приложения (iPhone и компьютер, где сайт установлен как приложение). */
export function setAppBadgeCount(n: number) {
  try {
    const nav = navigator as unknown as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) void nav.setAppBadge?.(n);
    else void nav.clearAppBadge?.();
  } catch {
    // не поддерживается
  }
}
