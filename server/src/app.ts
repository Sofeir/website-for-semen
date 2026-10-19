import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, HttpError } from './lib/http';
import { csrfProtection, denyCustomer, limitAssistant, loadSession, requireAuth } from './auth/session';
import { authRouter } from './routes/auth';
import { dictionariesRouter } from './routes/dictionaries';
import { usersRouter } from './routes/users';
import { clientsRouter } from './routes/clients';
import { ordersRouter } from './routes/orders';
import { tasksRouter } from './routes/tasks';
import { equipmentRouter } from './routes/equipment';
import { reportsRouter } from './routes/reports';
import { notificationsRouter } from './routes/notifications';
import { actsRouter } from './routes/acts';
import { documentsRouter } from './routes/documents';
import { filesRouter } from './routes/files';
import { importRouter } from './routes/import';
import { customerRouter } from './routes/customer';
import { customersRouter } from './routes/customers';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

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
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(loadSession);

  const api = express.Router();
  api.use(csrfProtection);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRouter);
  api.use(requireAuth);
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
  api.use(notificationsRouter);
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
