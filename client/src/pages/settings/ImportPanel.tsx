import { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { IMPORT_FIELDS, type ClientKind, type ImportField, type ImportPreview } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { Card, ErrorBox } from '@/ui/Display';
import { Segmented, Select } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import s from './Settings.module.css';

interface ImportStats {
  created: number;
  existing: number;
  devices: number;
  skipped: number;
  errors: string[];
}

/**
 * Импорт клиентов и техники: загрузить файл → посмотреть первые строки →
 * сопоставить колонки с полями → загрузить. Дубли по телефону и ИНН не создаются.
 */
export function ImportPanel() {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [kind, setKind] = useState<ClientKind>('person');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<ImportStats | null>(null);

  const upload = async (file: File) => {
    setError('');
    setStats(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const p = await api.post<ImportPreview>('/import/preview', fd);
      setPreview(p);
      setMapping(p.suggested);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<ImportStats>('/import/commit', { token: preview.token, kind, mapping });
      setStats(r);
      setPreview(null);
      inv('clients');
      toast.success('Импорт завершён');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const fieldFor = (col: number) => Object.entries(mapping).find(([, v]) => v === col)?.[0] ?? '';
  const setCol = (col: number, field: string) => {
    const next = Object.fromEntries(Object.entries(mapping).filter(([k, v]) => v !== col && k !== field));
    if (field) next[field] = col;
    setMapping(next);
  };

  return (
    <Card>
      <div className="stack">
        <div>
          <h3 className={s.dictTitle}>Импорт клиентов и техники</h3>
          <p className={s.dictHint}>
            Файл .xlsx или .csv, первая строка — заголовки. Клиент с тем же телефоном (или ИНН у юрлица) не задвоится: к нему
            просто добавится техника.
          </p>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {stats && (
          <div className={s.importDone}>
            <CheckCircle2 aria-hidden />
            <div>
              <b>
                Новых клиентов: {stats.created}, уже были: {stats.existing}, техники добавлено: {stats.devices}
              </b>
              {stats.skipped > 0 && <p>Пропущено пустых строк: {stats.skipped}</p>}
              {stats.errors.map((er) => (
                <p key={er}>{er}</p>
              ))}
            </div>
          </div>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept=".xlsx,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) upload(f);
          }}
        />
        {!preview && (
          <div>
            <Button icon={<Upload size={18} aria-hidden />} loading={busy} onClick={() => input.current?.click()}>
              Выбрать файл
            </Button>
          </div>
        )}

        {preview && (
          <>
            <div className="row wrap">
              <FileSpreadsheet aria-hidden size={20} />
              <span>
                Строк с данными: <b className="num">{preview.totalRows}</b>. Ниже первые {preview.rows.length}.
              </span>
            </div>
            <Segmented
              label="Кого импортируем"
              layoutId="import-kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'person', label: 'Физлица' },
                { value: 'legal', label: 'Юрлица' },
              ]}
            />
            <div className={s.previewWrap}>
              <table className={s.preview}>
                <thead>
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} scope="col">
                        <span className={s.previewHeader}>{h}</span>
                        <Select
                          aria-label={`Поле для колонки «${h}»`}
                          value={fieldFor(i)}
                          onChange={(e) => setCol(i, e.target.value)}
                        >
                          <option value="">Не загружать</option>
                          {(Object.keys(IMPORT_FIELDS) as ImportField[]).map((f) => (
                            <option key={f} value={f}>
                              {IMPORT_FIELDS[f]}
                            </option>
                          ))}
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, ri) => (
                    <tr key={ri}>
                      {preview.headers.map((_, ci) => (
                        <td key={ci}>{r[ci]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mapping.name === undefined && (
              <ErrorBox>Выберите колонку для поля «Имя / название» — без него клиента не создать.</ErrorBox>
            )}
            <div className="row wrap">
              <Button loading={busy} disabled={mapping.name === undefined} onClick={commit}>
                Загрузить {preview.totalRows} строк
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Отмена
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
