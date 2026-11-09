import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, HttpError } from './lib/http';
import { createLimiter } from './lib/requestLimit';
import { csrfProtection, denyCustomer, limitAssistant, loadSession, requireAuth } from './auth/session';
import { authRouter } from './routes/auth';
import { dictionariesRouter } from './routes/dictionaries';
import { usersRouter } from './routes/users';
import { clientsRouter } from './routes/clients';
import { ordersRouter } from './routes/orders';
import { tasksRouter } from './routes/tasks';
import { equipmentRouter } from './routes/equipment';
import { reportsRouter } from './routes/reports';
import { contactsRouter } from './routes/contacts';
import { analyticsRouter } from './routes/analytics';
import { notificationsRouter } from './routes/notifications';
import { pushRouter } from './routes/push';
import { reportsXlsxRouter } from './routes/reportsXlsx';
import { actsRouter } from './routes/acts';
import { documentsRouter } from './routes/documents';
import { filesRouter } from './routes/files';
import { importRouter } from './routes/import';
import { customerRouter } from './routes/customer';
import { customersRouter } from './routes/customers';
import { calendarFeedRouter } from './routes/calendar';
import { personalRouter } from './routes/personal';
import { googleRouter } from './routes/google';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'self'"],
          // Просит браузер переписывать http-адреса на https. Без сертификата сайт тогда не открывается,
          // поэтому включаем, только когда сервис работает по https (COOKIE_SECURE=true).
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
      // То же для HSTS: он запоминает «этот сайт только по https»
      hsts: config.cookieSecure,
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Что страница не должна делать на устройстве, кроме съёмки фото для заявки
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(loadSession);

  const api = express.Router();
  // Ответы API с личными данными не должны оседать в кэше браузера и прокси; файлы и документы ставят свой заголовок сами
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Общий потолок частоты: обычной работе (десятки запросов в минуту) не мешает, перебор и «заваливание» останавливает
  api.use(createLimiter({ windowMs: 60_000, max: 900 }));
  api.use(csrfProtection);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  // Регистрация и открытая лента календаря доступны без входа: на них свои, более строгие потолки по адресу
  api.use('/auth/register', createLimiter({ windowMs: 3600_000, max: 20 }));
  api.use('/calendar', createLimiter({ windowMs: 60_000, max: 60 }));
  api.use('/auth', authRouter);
  api.use(calendarFeedRouter); // лента задач для внешнего календаря: открывается по секретной ссылке, без входа
  api.use(requireAuth);
  // Тяжёлые действия (загрузка файлов, отчёты, документы, выгрузки) — не чаще 60 раз в минуту на сотрудника
  const heavy = createLimiter({ windowMs: 60_000, max: 60 });
  api.use(['/uploads', '/documents', '/reports', '/analytics', '/import'], heavy);
  api.use(customerRouter); // кабинет заказчика — единственное, что ему открыто, кроме уведомлений
  api.use(denyCustomer);
  api.use(limitAssistant);
  api.use(customersRouter);
  api.use(dictionariesRouter);
  api.use(usersRouter);
  api.use(clientsRouter);
  api.use(ordersRouter);
  api.use(tasksRouter);
  api.use(equipmentRouter);
  api.use(reportsRouter);
  api.use(reportsXlsxRouter);
  api.use(contactsRouter);
  api.use(analyticsRouter);
  api.use(notificationsRouter);
  api.use(pushRouter);
  api.use(personalRouter);
  api.use(googleRouter);
  api.use(actsRouter);
  api.use(documentsRouter);
  api.use(filesRouter);
  api.use(importRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'Нет такого адреса API')));
  app.use('/api', api);

  // В продакшене сервер сам отдаёт собранный клиент.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '7d' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
