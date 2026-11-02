import { useSyncExternalStore } from 'react';

/** Событие Chrome/Edge «сайт можно установить как приложение». Его нужно поймать сразу при загрузке и придержать до нажатия кнопки. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * installed — сайт уже открыт как приложение; prompt — браузер готов установить по кнопке;
 * insecure — адрес без https, браузер не даёт установку кнопкой (остаётся «ярлык в отдельном окне»);
 * manual — установка только через меню браузера (Safari, Firefox и т. п.).
 */
export type InstallState = 'installed' | 'prompt' | 'insecure' | 'manual';

function getState(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (!window.isSecureContext) return 'insecure';
  return 'manual';
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getState, () => 'manual' as InstallState);
}

export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  deferred = null;
  emit();
  return outcome === 'accepted';
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
