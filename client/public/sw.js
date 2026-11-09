// Сервис-воркер: даёт установить сайт как приложение и показывает системные уведомления (Web Push).
// Ничего не кэширует и запросы не трогает.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

async function setBadge(count) {
  try {
    if (typeof count !== 'number') return;
    if (count > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    else if (count === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (e) {
    // значок на иконке поддерживают не все устройства
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Новое уведомление' };
  }
  event.waitUntil(
    (async () => {
      await setBadge(data.unread);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Если сайт открыт и виден на экране, он сам показывает окно со звуком. Телефоны Apple требуют показывать каждое push-сообщение,
      // поэтому окно всё равно создаём, но тихо и на пару секунд.
      const watching = windows.some((w) => w.visibilityState === 'visible' && w.focused);
      await self.registration.showNotification(data.title || 'Сервис', {
        body: data.body || '',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        silent: watching,
        data: { url: data.url || '/' },
      });
      if (watching) {
        await new Promise((r) => setTimeout(r, 3000));
        const list = await self.registration.getNotifications({ tag: data.tag });
        list.forEach((n) => n.close());
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (existing) {
        await existing.focus();
        try {
          await existing.navigate(target);
        } catch (e) {
          // навигация недоступна — вкладка уже открыта, достаточно фокуса
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
