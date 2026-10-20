import { useEffect, useMemo, useState } from 'react';
import { Link2Off, Monitor, Plus, Save, Trash2 } from 'lucide-react';
import { REFILL_OP_LABELS, WORK_KIND_LABELS, formatMoney, type Device, type DeviceWork, type RefillOp } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useAuth } from '@/app/auth';
import { useDeviceComponents, useDeviceWorks, useDictionaries, useInvalidate } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { Button, IconButton } from '@/ui/Button';
import { ErrorBox, Pill } from '@/ui/Display';
import { Field, Input, Select, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { WorkSheet } from './WorkSheet';
import s from './DeviceJournalSheet.module.css';

type DeviceLite = Pick<Device, 'id' | 'clientId' | 'title' | 'serial' | 'inventoryNo' | 'location'> & {
  parentId?: number | null;
  deviceType?: string;
};

/** Рабочее место собирается вокруг системного блока или ноутбука. */
const hasWorkplace = (d: DeviceLite) => !d.parentId && (d.deviceType === 'Компьютер' || d.deviceType === 'Ноутбук');

const fmtPages = (n: number) => `${n.toLocaleString('ru-RU')} стр.`;

/** Замена детали раньше расчётного ресурса: прошлую запись той же детали берём из журнала. */
function earlyReplacements(works: DeviceWork[]) {
  const early = new Map<number, { passed: number; resource: number }>();
  const byPart = new Map<string, DeviceWork[]>();
  for (const w of works) {
    if (w.kind !== 'part' || w.counter === null) continue;
    const key = w.title.trim().toLowerCase();
    byPart.set(key, [...(byPart.get(key) ?? []), w]);
  }
  for (const list of byPart.values()) {
    const sorted = [...list].sort((a, b) => +new Date(a.doneAt) - +new Date(b.doneAt) || a.id - b.id);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.resource && cur.counter! - prev.counter! < prev.resource) {
        early.set(cur.id, { passed: cur.counter! - prev.counter!, resource: prev.resource });
      }
    }
  }
  return early;
}

/**
 * Журнал техники: паспорт, состав рабочего места, история работ и замен с суммами и гарантией.
 * Видно, когда меняли деталь и на каком пробеге, не сменили ли её раньше срока и сколько денег ушло на технику.
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
  const components = useDeviceComponents(device && hasWorkplace(device) ? device.id : null);
  const dict = useDictionaries();
  const inv = useInvalidate();
  const toast = useToast();
  const { can } = useAuth();
  const [inventoryNo, setInventoryNo] = useState('');
  const [location, setLocation] = useState('');
  const [serial, setSerial] = useState('');
  const [workOpen, setWorkOpen] = useState(false);
  const [compType, setCompType] = useState('');
  const [compModel, setCompModel] = useState('');
  const [compSerial, setCompSerial] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const early = useMemo(() => earlyReplacements(works.data ?? []), [works.data]);
  const spent = (works.data ?? []).reduce((sum, w) => sum + (w.amount ?? 0), 0);

  /** Замены деталей с пробегом: когда менялось и когда ждать следующую замену. */
  const forecasts = useMemo(() => {
    const parts = (works.data ?? []).filter((w) => w.kind === 'part' && w.counter !== null);
    const current = Math.max(0, ...(works.data ?? []).map((w) => w.counter ?? 0));
    const byTitle = new Map<string, DeviceWork[]>();
    for (const w of parts) {
      const key = w.title.trim().toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), w]);
    }
    return [...byTitle.values()].map((list) => {
      const sorted = [...list].sort((a, b) => a.counter! - b.counter!);
      const last = sorted[sorted.length - 1];
      const step = sorted.length >= 2 ? Math.round((last.counter! - sorted[0].counter!) / (sorted.length - 1)) : null;
      const next = last.resource ? last.counter! + last.resource : step ? last.counter! + step : null;
      return { title: last.title, last: last.counter!, resource: last.resource, step, next, current };
    });
  }, [works.data]);

  useEffect(() => {
    if (!device) return;
    setInventoryNo(device.inventoryNo ?? '');
    setLocation(device.location ?? '');
    setSerial(device.serial ?? '');
    setCompType('');
    setCompModel('');
    setCompSerial('');
    setError('');
  }, [device]);

  const refresh = () => inv('clients', 'client', 'orders', 'order', 'deviceWorks', 'deviceComponents', 'clientWorks');

  const saveInfo = async () => {
    setError('');
    try {
      await api.put(`/devices/${device!.id}`, { inventoryNo, location, serial, parentId: device!.parentId ?? null });
      refresh();
      toast.success('Данные техники сохранены');
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const addComponent = async () => {
    setError('');
    if (!Number(compType)) return setError('Выберите тип комплектующего');
    if (compModel.trim().length < 2) return setError('Напишите модель, например: монитор 27" Samsung');
    setBusy(true);
    try {
      await api.post(`/devices/${device!.id}/components`, {
        deviceTypeId: Number(compType),
        modelText: compModel.trim(),
        serial: compSerial.trim() || null,
      });
      refresh();
      setCompModel('');
      setCompSerial('');
      toast.success('Добавлено в рабочее место');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (c: Device) => {
    try {
      await api.put(`/devices/${c.id}`, { inventoryNo: c.inventoryNo, location: c.location, serial: c.serial, parentId: null });
      refresh();
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/works/${id}`);
      refresh();
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
        <>
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button icon={<Plus size={18} aria-hidden />} onClick={() => setWorkOpen(true)}>
            Записать работу
          </Button>
        </>
      }
    >
      {device && (
        <div className="stack">
          {error && <ErrorBox>{error}</ErrorBox>}

          <div className={s.stats}>
            <div className={s.stat}>
              <b>{works.data?.length ?? 0}</b>
              <span>работ в журнале</span>
            </div>
            <div className={s.stat}>
              <b>{formatMoney(spent)}</b>
              <span>потрачено на технику</span>
            </div>
            <div className={s.stat}>
              <b>{early.size}</b>
              <span>замен раньше срока</span>
            </div>
          </div>

          <section className="stack" aria-label="Паспорт техники">
            <h3 className={s.h}>Паспорт</h3>
            <div className={formStyles.grid2}>
              <Field label="Номер" optional hint="Своя нумерация предприятия, например ПК-054">
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

          {hasWorkplace(device) && (
            <section className="stack" aria-label="Состав рабочего места">
              <h3 className={s.h}>Состав рабочего места{components.data ? ` (${components.data.length})` : ''}</h3>
              <p className="muted">Монитор, клавиатура, мышь входят в рабочее место. Замену любой части записывайте в журнал.</p>
              {components.data?.length ? (
                <ul className={s.list}>
                  {components.data.map((c) => (
                    <li key={c.id} className={s.item}>
                      <Monitor size={18} aria-hidden className={s.icon} />
                      <div className={s.itemMain}>
                        <b>{c.title}</b>
                        <span className={s.meta}>
                          {c.deviceType}
                          {c.serial ? `, серийный номер ${c.serial}` : ''}
                        </span>
                      </div>
                      <IconButton label="Убрать из рабочего места" onClick={() => detach(c)}>
                        <Link2Off />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Состав не заполнен.</p>
              )}
              <div className={formStyles.grid2}>
                <Field label="Что добавить">
                  <Select value={compType} onChange={(e) => setCompType(e.target.value)}>
                    <option value="">Тип техники</option>
                    {(dict.data?.deviceTypes ?? [])
                      .filter((t) => t.isActive)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Модель">
                  <Input value={compModel} onChange={(e) => setCompModel(e.target.value)} placeholder='Монитор Samsung 27"' maxLength={150} />
                </Field>
                <Field label="Серийный номер" optional className={formStyles.span2}>
                  <Input value={compSerial} onChange={(e) => setCompSerial(e.target.value)} maxLength={100} />
                </Field>
              </div>
              <div>
                <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={addComponent} loading={busy}>
                  Добавить
                </Button>
              </div>
            </section>
          )}

          {forecasts.length > 0 && (
            <section className="stack" aria-label="Когда менять">
              <h3 className={s.h}>Когда менять</h3>
              <ul className={s.list}>
                {forecasts.map((f) => (
                  <li key={f.title} className={s.item}>
                    <div className={s.itemMain}>
                      <b>{f.title}</b>
                      <span className={s.meta}>
                        Последняя замена на {fmtPages(f.last)}
                        {f.current > f.last && `, с тех пор напечатано ещё ${f.current - f.last} стр.`}
                      </span>
                      <span className={s.note}>
                        {f.next
                          ? f.resource
                            ? `Ресурс ${fmtPages(f.resource)}: ждём замену около ${fmtPages(f.next)}`
                            : `Ждать следующую замену около ${fmtPages(f.next)} (обычно каждые ${f.step!.toLocaleString('ru-RU')})`
                          : 'Чтобы появился прогноз, укажите ресурс детали или запишите ещё одну замену с пробегом.'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stack" aria-label="История работ">
            <h3 className={s.h}>История работ{works.data ? ` (${works.data.length})` : ''}</h3>
            {works.data?.length ? (
              <ul className={s.list}>
                {works.data.map((w) => {
                  const e = early.get(w.id);
                  const part = [w.partBrand, w.partSpec].filter(Boolean).join(' ');
                  return (
                    <li key={w.id} className={s.item}>
                      <div className={s.itemMain}>
                        <b>
                          {w.title}
                          {w.qty > 1 ? ` × ${w.qty}` : ''}
                          {w.amount !== null && <span className={s.sum}> {formatMoney(w.amount)}</span>}
                        </b>
                        <span className={s.meta}>
                          {fmtWhen(w.doneAt)}
                          {w.counter !== null && `, пробег ${fmtPages(w.counter)}`}
                          {w.orderNumber && `, заявка №${w.orderNumber}`}
                          {w.performerName && `, делал ${w.performerName}`}
                        </span>
                        {(part || w.warrantyMonths) && (
                          <span className={s.note}>
                            {part}
                            {part && w.warrantyMonths ? ', ' : ''}
                            {w.warrantyMonths ? `гарантия ${w.warrantyMonths} мес.` : ''}
                          </span>
                        )}
                        {w.ops.length > 0 && (
                          <span className={s.note}>{w.ops.map((o) => REFILL_OP_LABELS[o as RefillOp] ?? o).join(', ')}</span>
                        )}
                        {e && (
                          <span className={s.early}>
                            Раньше срока: прошло {fmtPages(e.passed)} из {fmtPages(e.resource)}
                          </span>
                        )}
                        {w.note && <span className={s.note}>{w.note}</span>}
                      </div>
                      <Pill tone="outline">{WORK_KIND_LABELS[w.kind]}</Pill>
                      {can('orders.viewAll') && (
                        <IconButton label="Удалить запись" onClick={() => remove(w.id)}>
                          <Trash2 />
                        </IconButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">Записей пока нет.</p>
            )}
          </section>
        </div>
      )}
      {device && (
        <WorkSheet
          open={workOpen}
          onClose={() => setWorkOpen(false)}
          target={{ clientId: device.clientId, deviceId: device.id, orderId: orderId ?? null }}
          kinds={['part', 'repair', 'service']}
          subtitle={device.title}
        />
      )}
    </Sheet>
  );
}
