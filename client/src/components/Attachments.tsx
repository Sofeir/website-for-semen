import { useRef, useState } from 'react';
import { FileText, ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import type { Attachment } from '@sd/shared';
import { useMe, useAuth } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { fmtWhen } from '@/lib/dates';
import { Button, IconButton } from '@/ui/Button';
import { useConfirm } from '@/ui/Confirm';
import { useToast } from '@/ui/Toast';
import s from './Attachments.module.css';

export const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.txt';
const MAX_MB = 15;

const sizeLabel = (b: number) =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`;

/** Загрузка файлов на сервер. Возвращает созданные вложения. */
export async function uploadFiles(files: File[], target: { orderId?: number; clientId?: number } = {}) {
  const tooBig = files.find((f) => f.size > MAX_MB * 1024 * 1024);
  if (tooBig) throw new ApiError(413, `«${tooBig.name}» больше ${MAX_MB} МБ`);
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  if (target.orderId) fd.append('orderId', String(target.orderId));
  if (target.clientId) fd.append('clientId', String(target.clientId));
  return api.post<Attachment[]>('/uploads', fd);
}

export function AttachmentList({
  items,
  onDeleted,
  compact,
}: {
  items: Attachment[];
  onDeleted?: (id: number) => void;
  compact?: boolean;
}) {
  const me = useMe();
  const { can } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  if (!items.length) return null;
  return (
    <ul className={s.list}>
      {items.map((a) => {
        const isImage = a.mime.startsWith('image/') && !a.mime.includes('heic');
        return (
          <li key={a.id} className={s.item}>
            <a href={a.url} target="_blank" rel="noreferrer" className={s.link}>
              {isImage ? (
                <img src={a.url} alt="" className={s.thumb} loading="lazy" />
              ) : (
                <span className={s.icon}>
                  {a.mime.startsWith('image/') ? <ImageIcon aria-hidden /> : <FileText aria-hidden />}
                </span>
              )}
              <span className={s.text}>
                <span className={s.name}>{a.fileName}</span>
                {!compact && (
                  <span className={s.meta}>
                    {sizeLabel(a.size)}, {fmtWhen(a.createdAt)}
                    {a.uploadedBy ? `, ${a.uploadedBy}` : ''}
                  </span>
                )}
              </span>
            </a>
            {onDeleted && (a.uploadedBy === me.fullName || can('orders.assign')) && (
              <IconButton
                label={`Удалить файл ${a.fileName}`}
                onClick={async () => {
                  if (!(await confirm({ title: 'Удалить файл?', body: a.fileName, confirm: 'Удалить', danger: true }))) return;
                  try {
                    await api.del(`/files/${a.id}`);
                    onDeleted(a.id);
                  } catch (e) {
                    toast.error('Не удалось удалить', (e as ApiError).message);
                  }
                }}
              >
                <Trash2 />
              </IconButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Кнопка «Добавить файлы» с загрузкой сразу на сервер. */
export function UploadButton({
  target,
  onUploaded,
  label = 'Добавить файлы',
}: {
  target: { orderId?: number; clientId?: number };
  onUploaded: (items: Attachment[]) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            onUploaded(await uploadFiles(files, target));
            toast.success(files.length > 1 ? `Загружено файлов: ${files.length}` : 'Файл загружен');
          } catch (err) {
            toast.error('Файл не загрузился', (err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        icon={busy ? undefined : <Upload size={16} aria-hidden />}
        loading={busy}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

export function AttachHint() {
  return (
    <p className={s.hint}>
      <Paperclip size={14} aria-hidden /> Фото, PDF, Word, Excel — до {MAX_MB} МБ каждый.
    </p>
  );
}
