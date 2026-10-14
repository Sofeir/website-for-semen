import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { can } from '@sd/shared';
import { config } from '../config';
import { one, pool } from '../db/pool';
import { forbidden, h, HttpError, intParam } from '../lib/http';

export const filesRouter = Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

/** Разрешённые типы: расширение → допустимые MIME. */
const ALLOWED: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.heic': ['image/heic', 'image/heif', 'application/octet-stream'],
  '.heif': ['image/heic', 'image/heif', 'application/octet-stream'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword', 'application/octet-stream'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  '.txt': ['text/plain'],
};

/** Сигнатуры файлов: проверяем первые байты, чтобы под .jpg не пришёл исполняемый файл. */
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  '.docx': (b) => b[0] === 0x50 && b[1] === 0x4b,
  '.xlsx': (b) => b[0] === 0x50 && b[1] === 0x4b,
  '.doc': (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  '.xls': (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  '.heic': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  '.heif': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  '.txt': (b) => !b.includes(0),
};

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimes = ALLOWED[ext];
    if (!mimes || !mimes.includes(file.mimetype)) {
      return cb(new HttpError(400, `Файл «${file.originalname}» не подходит. Можно фото, PDF, Word, Excel, текст.`));
    }
    cb(null, true);
  },
});

// multer отдаёт имя в latin1 — возвращаем кириллицу.
const fixName = (name: string) => Buffer.from(name, 'latin1').toString('utf8');

filesRouter.post(
  '/uploads',
  upload.array('files', 10),
  h(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw new HttpError(400, 'Файл не выбран');
    const orderId = req.body.orderId ? intParam(req.body.orderId, 'orderId') : null;
    const clientId = req.body.clientId ? intParam(req.body.clientId, 'clientId') : null;
    const result = [];
    try {
      for (const f of files) {
        const ext = path.extname(f.originalname).toLowerCase();
        const fd = await fsp.open(f.path, 'r');
        const head = Buffer.alloc(16);
        await fd.read(head, 0, 16, 0);
        await fd.close();
        if (!MAGIC[ext]?.(head)) throw new HttpError(400, `Содержимое «${fixName(f.originalname)}» не совпадает с расширением`);
      }
      let linkedClient = clientId;
      if (orderId) {
        const o = await one<{ client_id: number }>('SELECT client_id FROM orders WHERE id = $1', [orderId]);
        if (!o) throw new HttpError(400, 'Заявка не найдена');
        linkedClient = o.client_id;
      }
      for (const f of files) {
        const row = await one(
          `INSERT INTO attachments (order_id, client_id, file_name, stored_name, mime, size, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, file_name AS "fileName", mime, size, created_at AS "createdAt"`,
          [orderId, linkedClient, fixName(f.originalname).slice(0, 200), f.filename, f.mimetype, f.size, req.user!.id],
        );
        result.push({ ...row, url: `/api/files/${row.id}`, uploadedBy: req.user!.fullName });
      }
    } catch (e) {
      await Promise.all(files.map((f) => fsp.unlink(f.path).catch(() => {})));
      throw e;
    }
    res.status(201).json(result);
  }),
);

filesRouter.get(
  '/files/:id',
  h(async (req, res) => {
    const a = await one('SELECT * FROM attachments WHERE id = $1', [intParam(req.params.id)]);
    if (!a) throw new HttpError(404, 'Файл не найден');
    const full = path.join(config.uploadDir, path.basename(a.stored_name));
    if (!fs.existsSync(full)) throw new HttpError(404, 'Файл пропал с диска');
    const inline = /^image\/(jpeg|png|webp)$/.test(a.mime) || a.mime === 'application/pdf';
    res.set({
      'Content-Type': a.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline && req.query.download !== '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    });
    fs.createReadStream(full).pipe(res);
  }),
);

filesRouter.delete(
  '/files/:id',
  h(async (req, res) => {
    const a = await one('SELECT * FROM attachments WHERE id = $1', [intParam(req.params.id)]);
    if (!a) throw new HttpError(404, 'Файл не найден');
    if (a.uploaded_by !== req.user!.id && !can(req.user!.role, 'orders.assign')) throw forbidden();
    await pool.query('DELETE FROM attachments WHERE id = $1', [a.id]);
    await fsp.unlink(path.join(config.uploadDir, path.basename(a.stored_name))).catch(() => {});
    res.json({ ok: true });
  }),
);
