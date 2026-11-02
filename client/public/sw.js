// Нужен только для того, чтобы браузер разрешил установить сайт как приложение. Ничего не кэширует и запросы не трогает.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
