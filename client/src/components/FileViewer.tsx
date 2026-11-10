import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, ExternalLink, FileText } from 'lucide-react';
import type { Attachment } from '@sd/shared';
import { Button, IconButton } from '@/ui/Button';
import s from './FileViewer.module.css';

const sizeLabel = (b: number) =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`;

/** Файлы, которые браузер показывает сам. HEIC (фото с iPhone) большинство компьютеров показать не может: для него только «Скачать». */
const isImage = (a: Attachment) => /^image\/(jpeg|png|webp|gif)$/.test(a.mime);
const isPdf = (a: Attachment) => a.mime === 'application/pdf';
const isVideo = (a: Attachment) => /^video\/(mp4|webm|quicktime)$/.test(a.mime);

/** Адрес для скачивания: тот же файл, но с заголовком «сохранить». */
const downloadUrl = (a: Attachment) => `${a.url}${a.url.includes('?') ? '&' : '?'}download=1`;

/**
 * Просмотр вложений прямо в сервисе: фото, PDF и видео открываются поверх страницы, сверху стрелка «Назад»,
 * кнопка «Скачать», счётчик и листание между файлами. Кнопка «Назад» на телефоне закрывает просмотр, а не уводит со страницы.
 */
export function FileViewer({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: Attachment[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const open = index !== null && items[index] !== undefined;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [broken, setBroken] = useState<number | null>(null);

  // Системная кнопка «Назад» (Android, жест на iPhone) закрывает просмотр: на время просмотра добавляем запись в историю
  const pushed = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!pushed.current) {
      window.history.pushState(window.history.state, '');
      pushed.current = true;
    }
    const onPop = () => {
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);
  // Закрыли кнопкой на экране или клавишей: лишнюю запись истории убираем, чтобы «Назад» не приходилось нажимать дважды
  useEffect(() => {
    if (!open && pushed.current) {
      pushed.current = false;
      window.history.back();
    }
  }, [open]);

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = index + delta;
      if (next >= 0 && next < items.length) onIndex(next);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, go]);

  if (!open || index === null) return null;
  const a = items[index]!;
  const failed = broken === a.id;

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  // Смахивание в сторону листает файлы; вертикальное движение и щипок остаются для прокрутки и масштаба
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? 1 : -1);
  };

  return createPortal(
    <div className={s.root} role="dialog" aria-modal="true" aria-label={`Файл ${a.fileName}`}>
      <header className={s.bar}>
        <IconButton label="Назад" className={s.back} onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <div className={s.title}>
          <span className={s.name}>{a.fileName}</span>
          <span className={s.meta}>
            {items.length > 1 ? `${index + 1} из ${items.length}` : ''}
            {items.length > 1 && a.size ? ', ' : ''}
            {a.size ? sizeLabel(a.size) : ''}
          </span>
        </div>
        <a className={s.download} href={downloadUrl(a)} download={a.fileName}>
          <Download aria-hidden size={20} />
          <span>Скачать</span>
        </a>
      </header>

      <div className={s.stage} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {isImage(a) && !failed && (
          <img key={a.id} src={a.url} alt={a.fileName} className={s.image} onError={() => setBroken(a.id)} />
        )}
        {isPdf(a) && !failed && <iframe key={a.id} src={a.url} title={a.fileName} className={s.frame} />}
        {isVideo(a) && !failed && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={a.id} src={a.url} controls playsInline className={s.video} onError={() => setBroken(a.id)} />
        )}
        {(failed || !(isImage(a) || isPdf(a) || isVideo(a))) && (
          <div className={s.fallback}>
            <FileText aria-hidden className={s.fallbackIcon} />
            <p className={s.fallbackName}>{a.fileName}</p>
            <p className={s.fallbackText}>
              {failed ? 'Файл не удалось показать.' : 'Этот тип файла нельзя посмотреть здесь.'} Скачайте его и откройте на
              устройстве.
            </p>
            <a className={s.fallbackDownload} href={downloadUrl(a)} download={a.fileName}>
              <Download aria-hidden size={20} /> Скачать
            </a>
          </div>
        )}

        {index > 0 && (
          <IconButton label="Предыдущий файл" className={`${s.nav} ${s.prev}`} onClick={() => go(-1)}>
            <ChevronLeft />
          </IconButton>
        )}
        {index < items.length - 1 && (
          <IconButton label="Следующий файл" className={`${s.nav} ${s.next}`} onClick={() => go(1)}>
            <ChevronRight />
          </IconButton>
        )}
      </div>

      {isPdf(a) && (
        <footer className={s.foot}>
          <Button
            variant="secondary"
            size="sm"
            icon={<ExternalLink size={16} aria-hidden />}
            onClick={() => window.open(a.url, '_blank', 'noopener')}
          >
            Открыть отдельно
          </Button>
        </footer>
      )}
    </div>,
    document.body,
  );
}

/**
 * Ссылка на PDF-документ сервиса (акт, квитанция, бланк): открывает его в просмотре поверх страницы, а не в новой вкладке,
 * где на телефоне нет кнопки «Назад». С нажатым Ctrl или Shift ведёт себя как обычная ссылка.
 */
export function DocLink({
  href,
  name,
  className,
  children,
}: {
  href: string;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const doc: Attachment = { id: 0, fileName: name, mime: 'application/pdf', size: 0, createdAt: '', url: href } as Attachment;
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
        onClick={(e) => {
          // в демо документы собираются прямо в браузере и открываются по-старому, в новой вкладке (см. demo/runtime.ts)
          if (import.meta.env.VITE_DEMO || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      <FileViewer items={[doc]} index={open ? 0 : null} onClose={() => setOpen(false)} onIndex={() => {}} />
    </>
  );
}
