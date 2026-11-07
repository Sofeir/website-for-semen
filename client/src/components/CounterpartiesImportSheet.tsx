import { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import type { CounterpartiesPreview } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';

/**
 * Загрузка контрагентов из выгрузки 1С (.xlsx): выбрать файл → посмотреть, что добавится и что пропустят → подтвердить.
 * Временная кнопка: нужна, чтобы загрузить список без доступа к серверу.
 */
export function CounterpartiesImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const [preview, setPreview] = useState<CounterpartiesPreview | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setPreview(null);
    setCreated(null);
    setError('');
    onClose();
  };

  const upload = async (file: File) => {
    setError('');
    setCreated(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setPreview(await api.post<CounterpartiesPreview>('/import/counterparties/preview', fd));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setError('');
    setBusy(true);
    try {
      const r = await api.post<{ created: number }>('/import/counterparties/commit', { token: preview.token });
      setCreated(r.created);
      setPreview(null);
      inv('clients');
      toast.success('Клиенты добавлены', `Добавлено: ${r.created}`);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Импорт контрагентов из Excel"
      subtitle="Выгрузка из 1С, файл .xlsx"
      width={680}
      footer={
        preview ? (
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Другой файл
            </Button>
            <Button loading={busy} disabled={!preview.willCreate} onClick={commit}>
              Добавить {preview.willCreate}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={close}>
            Закрыть
          </Button>
        )
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <input
          ref={input}
          type="file"
          hidden
          accept=".xlsx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) upload(f);
          }}
        />
        {created !== null && (
          <p className="row" style={{ gap: 8 }}>
            <CheckCircle2 aria-hidden size={20} />
            <b>Добавлено клиентов: {created}</b>
          </p>
        )}
        {!preview && (
          <>
            <p className="muted">
              Колонки: «Наименование в программе», ИНН, КПП, «Ответственный», «Полное наименование». Добавляются все строки, в том числе серые. Клиент,
              у которого такой ИНН или такое название уже есть, не задвоится. В ИНН и КПП остаются только цифры.
            </p>
            <div>
              <Button icon={<Upload size={18} aria-hidden />} loading={busy} onClick={() => input.current?.click()}>
                Выбрать файл
              </Button>
            </div>
          </>
        )}
        {preview && (
          <>
            <p className="row wrap" style={{ gap: 8 }}>
              <FileSpreadsheet aria-hidden size={20} />
              <span>
                Строк в файле: <b className="num">{preview.totalRows}</b>, из них серых: <b className="num">{preview.gray}</b>. Будет добавлено:{' '}
                <b className="num">{preview.willCreate}</b>. Пропущено как дубли: <b className="num">{preview.skipped.length}</b>.
              </span>
            </p>
            {preview.skipped.length > 0 && (
              <div>
                <b>Пропущены (такой клиент уже есть)</b>
                <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {preview.skipped.map((r) => (
                    <li key={r.line}>
                      строка {r.line}: {r.name}: {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.unusual.length > 0 && (
              <div>
                <b>Добавятся, но ИНН или КПП неполные (цифры как в файле, исправьте в карточке)</b>
                <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {preview.unusual.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
