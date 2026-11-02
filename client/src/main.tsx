import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';
import { installSmoothWheel } from './lib/smoothWheel';
import { listenForInstall } from './lib/installApp';

installSmoothWheel();
listenForInstall();

// Служебный скрипт нужен браузеру, чтобы разрешить установку сайта как приложения (только по https и на localhost).
if (import.meta.env.PROD && !import.meta.env.VITE_DEMO && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

if (import.meta.env.VITE_DEMO) {
  // Демо работает без сервера: готовим базу заранее и открываем PDF из браузера.
  import('./demo/runtime').then(({ bootDemo, installPdfLinks }) => {
    installPdfLinks();
    bootDemo();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
