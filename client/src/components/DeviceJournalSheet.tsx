import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { WORK_KINDS, WORK_KIND_LABELS, type Device, type WorkKind } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useAuth } from '@/app/auth';
import { useDeviceWorks, useInvalidate } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { Button, IconButton } from '@/ui/Button';
import { ErrorBox, Pill } from '@/ui/Display';
import { Field, Input, Segmented, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './DeviceJournalSheet.module.css';

type DeviceLite = Pick<Device, 'id' | 'clientId' | 'title' | 'serial' | 'inventoryNo' | 'location'>;

/**
 * Журнал техники: своя нумерация и место, история работ и замен с пробегом.
 * Нужен, чтобы видеть, когда меняли фотобарабан и на каком пробеге, и ждать следующую замену.
 */
export function DeviceJournalSheet({
  device,
  orderId,
  onClose,
}: {
  device: DeviceLite | null;
  orderId?: number;
  onClose: () => void;
}) {
  const works = useDeviceWorks(device?.id ?? null);
  const inv = useInvalidate();
  const toast = useToast();
  const { can } = useAuth();
  const [inventoryNo, setInventoryNo] = useState('');
  const [location, setLocation] = useState('');
  const [serial, setSerial] = useState('');
  const [kind, setKind] = useState<WorkKind>('part');
  const [title, setTitle] = useState('');
  const [qty, setQty] = useState('1');
  const [counter, setCounter] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!device) return;
    setInventoryNo(device.inventoryNo ?? '');
    setLocation(device.location ?? '');
    setSerial(device.serial ?? '');
    setKind('part');
    setTitle('');
    setQty('1');
    setCounter('');
    setNote('');
    setError('');
  }, [device]);

  const saveInfo = async () => {
    setError('');
    try {
      await api.put(`/devices/${device!.id}`, { inventoryNo, location, serial });
      inv('clients', 'orders');
      toast.success('Данные техники сохранены');
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const addWork = async () => {
    setError('');
    if (title.trim().length < 2) return setError('Напишите, что сделано');
    setBusy(true);
    try {
      await api.post('/works', {
        deviceId: device!.id,
        clientId: device!.clientId,
        orderId: orderId ?? null,
        kind,
        title: title.trim(),
        qty: Number(qty) || 1,
        counter: counter ? Number(counter.replace(/\s/g, '')) : null,
        note: note.trim() || null,
      });
      inv('clients', 'orders');
      toast.success('Работа записана');
      setTitle('');
      setCounter('');
      setNote('');
      setQty('1');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/works/${id}`);
      inv('clients', 'orders');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  return (
    <Sheet
      open={Boolean(device)}
      onClose={onClose}
      title="Журнал техники"
      subtitle={device?.title}
      full
      width={620}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      {device && (
        <div className="stack">
          {error && <ErrorBox>{error}</ErrorBox>}

          <section className="stack" aria-label="Паспорт техники">
            <h3 className={s.h}>Паспорт</h3>
            <div className={formStyles.grid2}>
              <Field label="Номер" optional hint="Своя нумерация предприятия">
                <Input value={inventoryNo} onChange={(e) => setInventoryNo(e.target.value)} maxLength={60} />
              </Field>
              <Field label="Серийный номер" optional>
                <Input value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={100} />
              </Field>
              <Field label="Где стоит" optional hint="Кабинет, отдел, сотрудник" className={formStyles.span2}>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
              </Field>
            </div>
            <div>
              <Button variant="secondary" icon={<Save size={18} aria-hidden />} onClick={saveInfo}>
                Сохранить паспорт
              </Button>
            </div>
          </section>

          <section className="stack" aria-label="История работ">
            <h3 className={s.h}>История работ{works.data ? ` (${works.data.length})` : ''}</h3>
            {works.data?.length ? (
              <ul className={s.list}>
                {works.data.map((w) => (
                  <li key={w.id} className={s.item}>
                    <div className={s.itemMain}>
                      <b>
                        {w.title}
                        {w.qty > 1 ? ` × ${w.qty}` : ''}
                      </b>
                      <span className={s.meta}>
                        {fmtWhen(w.doneAt)}
                        {w.counter !== null && `, пробег ${w.counter.toLocaleString('ru-RU')} стр.`}
                        {w.orderNumber && `, заявка №${w.orderNumber}`}
                        {w.createdByName && `, ${w.createdByName}`}
                      </span>
                      {w.note && <span className={s.note}>{w.note}</span>}
                    </div>
                    <Pill tone="outline">{WORK_KIND_LABELS[w.kind]}</Pill>
                    {(can('orders.viewAll') || w.createdByName) && (
                      <IconButton label="Удалить запись" onClick={() => remove(w.id)}>
                        <Trash2 />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Записей пока нет.</p>
            )}
          </section>

          <section className="stack" aria-label="Записать работу">
            <h3 className={s.h}>Записать работу</h3>
            <Segmented<WorkKind>
              block
              label="Вид работы"
              layoutId="work-kind"
              value={kind}
              onChange={setKind}
              options={WORK_KINDS.filter((k) => k !== 'refill').map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))}
            />
            <Field label="Что сделано">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: блок фотобарабана" maxLength={200} />
            </Field>
            <div className={formStyles.grid2}>
              <Field label="Пробег, стр." optional hint="Счётчик устройства на момент работы">
                <Input inputMode="numeric" value={counter} onChange={(e) => setCounter(e.target.value)} placeholder="80000" />
              </Field>
              <Field label="Количество">
                <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
            </div>
            <Field label="Заметка" optional>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
            </Field>
            <div>
              <Button onClick={addWork} loading={busy} icon={<Plus size={18} aria-hidden />}>
                Записать
              </Button>
            </div>
          </section>
        </div>
      )}
    </Sheet>
  );
}
