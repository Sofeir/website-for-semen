import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, MessageSquarePlus, MessageSquareText, Save } from 'lucide-react';
import { INSPECTION_LABELS, inspectionKindOf, type Device, type Inspection } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useDictionaries, useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Checkbox, Field, Input, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './InspectionSheet.module.css';

/**
 * Проверка одной единицы техники по бланку: ПК или МФУ/принтер. Пункты берутся из справочника,
 * сотрудник и имя ПК подставляются из прошлой проверки этой техники.
 * У каждого пункта можно оставить комментарий: пункт с замечанием становится жёлтым, а если он не сделан, красным.
 */
export function InspectionSheet({
  device,
  previous,
  taskId,
  initial,
  onClose,
  onNext,
}: {
  device: Device | null;
  /** Прошлая проверка этой техники, если была. */
  previous: Inspection | null;
  /** Выезд, в рамках которого идёт проверка. */
  taskId?: number | null;
  /** Проверка этой техники в этом же выезде: открываем с уже поставленными отметками. */
  initial?: Inspection | null;
  onClose: () => void;
  /** Если есть следующая непроверенная техника, показываем «Сохранить и дальше». */
  onNext?: () => void;
}) {
  const dict = useDictionaries();
  const inv = useInvalidate();
  const toast = useToast();
  const kind = device ? inspectionKindOf(device.deviceType) : null;
  const items = useMemo(
    () => (kind === 'printer' ? dict.data?.inspectPrinter : dict.data?.inspectPc)?.filter((i) => i.isActive) ?? [],
    [dict.data, kind],
  );
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openComment, setOpenComment] = useState<Record<string, boolean>>({});
  const [host, setHost] = useState('');
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [counter, setCounter] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!device) return;
    setDone(Object.fromEntries((initial?.items ?? []).filter((i) => i.done).map((i) => [i.title, true])));
    setComments(Object.fromEntries((initial?.items ?? []).filter((i) => i.comment).map((i) => [i.title, i.comment as string])));
    setOpenComment({});
    setHost(initial?.hostName ?? previous?.hostName ?? '');
    setPerson(initial?.personName ?? previous?.personName ?? '');
    setPhone(initial?.personPhone ?? previous?.personPhone ?? '');
    setCounter(initial?.counter != null ? String(initial.counter) : '');
    setNote(initial?.note ?? '');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

  if (!device || !kind) return null;
  const printer = kind === 'printer';
  const total = items.length;
  const count = items.filter((i) => done[i.name]).length;
  const remarks = items.filter((i) => comments[i.name]?.trim()).length;
  const stateOf = (name: string) =>
    comments[name]?.trim() ? (done[name] ? 'warn' : 'bad') : done[name] ? 'ok' : 'none';

  const save = async (next: boolean) => {
    setError('');
    setBusy(true);
    try {
      await api.post('/inspections', {
        deviceId: device.id,
        taskId: taskId ?? null,
        hostName: printer ? null : host.trim() || null,
        personName: person.trim() || null,
        personPhone: phone.trim() || null,
        counter: printer ? counter.replace(/\s/g, '') : null,
        note: note.trim() || null,
        items: items.map((i) => ({ title: i.name, done: Boolean(done[i.name]), comment: comments[i.name]?.trim() || null })),
      });
      inv('clients', 'client', 'clientInspections', 'visitDevices', 'deviceWorks', 'clientWorks', 'report', 'analytics', 'visits');
      toast.success('Проверка сохранена');
      if (next && onNext) onNext();
      else onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={INSPECTION_LABELS[kind]}
      subtitle={`${device.inventoryNo ? `${device.inventoryNo}: ` : ''}${device.title}${device.location ? `, ${device.location}` : ''}`}
      width={560}
      full
      footer={
        <>
          {!onNext && (
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
          )}
          {onNext ? (
            <>
              <Button variant="secondary" onClick={() => save(false)} loading={busy}>
                Сохранить
              </Button>
              <Button onClick={() => save(true)} loading={busy} icon={<Save size={18} aria-hidden />}>
                Сохранить и дальше
              </Button>
            </>
          ) : (
            <Button onClick={() => save(false)} loading={busy} icon={<Save size={18} aria-hidden />}>
              Сохранить
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className={formStyles.grid2}>
          {!printer && (
            <Field label="Имя ПК" optional>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="BUH-01" maxLength={100} />
            </Field>
          )}
          <Field label={printer ? 'Ответственный в организации' : 'ФИО сотрудника'} optional>
            <Input value={person} onChange={(e) => setPerson(e.target.value)} maxLength={150} autoComplete="off" />
          </Field>
          <Field label="Телефон" optional>
            <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} autoComplete="off" />
          </Field>
          {printer && (
            <Field label="Пробег, стр." optional hint={previous?.counter ? `Прошлый раз: ${previous.counter}` : 'Счётчик на аппарате'}>
              <Input inputMode="numeric" value={counter} onChange={(e) => setCounter(e.target.value)} placeholder="80000" />
            </Field>
          )}
        </div>

        <div className={s.listHead}>
          <b>
            Отмечено {count} из {total}
            {remarks > 0 && `, замечаний: ${remarks}`}
          </b>
          <Button
            size="sm"
            variant="secondary"
            icon={<CheckCheck size={16} aria-hidden />}
            onClick={() => setDone(Object.fromEntries(items.map((i) => [i.name, true])))}
          >
            Всё в порядке
          </Button>
        </div>
        <p className={s.legend}>
          <span>
            <span className={s.dot} data-state="ok" aria-hidden />
            в порядке
          </span>
          <span>
            <span className={s.dot} data-state="warn" aria-hidden />
            сделано, есть замечание
          </span>
          <span>
            <span className={s.dot} data-state="bad" aria-hidden />
            не сделано, есть замечание
          </span>
        </p>
        <ul className={s.list}>
          {items.map((i) => {
            const text = comments[i.name] ?? '';
            const shown = openComment[i.name] || Boolean(text);
            return (
              <li key={i.id} className={s.item} data-state={stateOf(i.name)}>
                <div className={s.row}>
                  <Checkbox
                    label={i.name}
                    checked={Boolean(done[i.name])}
                    onChange={(e) => setDone((d) => ({ ...d, [i.name]: e.target.checked }))}
                  />
                  <button
                    type="button"
                    className={s.commentBtn}
                    data-has={Boolean(text.trim())}
                    aria-label={text.trim() ? `Комментарий к пункту «${i.name}»` : `Добавить комментарий к пункту «${i.name}»`}
                    aria-expanded={shown}
                    onClick={() => setOpenComment((o) => ({ ...o, [i.name]: !shown }))}
                  >
                    {text.trim() ? <MessageSquareText size={20} aria-hidden /> : <MessageSquarePlus size={20} aria-hidden />}
                  </button>
                </div>
                {shown && (
                  <Input
                    value={text}
                    onChange={(e) => setComments((c) => ({ ...c, [i.name]: e.target.value }))}
                    placeholder="Что не так: например, диск в плохом состоянии"
                    maxLength={500}
                    aria-label={`Комментарий к пункту «${i.name}»`}
                    autoFocus={!text}
                  />
                )}
              </li>
            );
          })}
        </ul>

        <Field label="Примечание" optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
      </div>
    </Sheet>
  );
}
