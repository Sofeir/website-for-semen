// Маршруты, которых в демо нет: загрузка файлов и импорт из Excel. Остальное работает как на сервере.
import { Router } from 'express';
import { HttpError } from '../../../server/src/lib/http';

const unavailable = () => {
  throw new HttpError(501, 'В демо-версии эта функция отключена. В рабочей версии она работает.');
};

export const filesRouter = Router();
filesRouter.post('/uploads', unavailable);
filesRouter.get('/files/:id', unavailable);
filesRouter.delete('/files/:id', unavailable);

export const importRouter = Router();
importRouter.post('/import/preview', unavailable);
importRouter.post('/import/commit', unavailable);
