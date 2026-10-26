import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Circle, Minus, Monitor, Printer } from 'lucide-react';
import { inspectionStatus, type Device, type InspectionStatus, type VisitDevice } from '@sd/shared';
import { useVisitDevices } from '@/api/queries';
import { EmptyState, Spinner } from '@/ui/Display';
import { InspectionSheet } from './InspectionSheet';
import s from './VisitDevices.module.css';

type State = InspectionStatus | 'none';

const STATE_TEXT: Record<State, string> = {
  none: 'не проверено',
  ok: 'в порядке',
  warn: 'есть замечания',
  bad: 'не сделано',
  partial: 'не до конца',
};

const MARK: Record<State, typeof Circle> = { none: Circle, ok: Check, warn: AlertTriangle, bad: AlertTriangle, partial: Minus };

const stateOf = (d: VisitDevice): State => (d.current ? inspectionStatus(d.current.items) : 'none');

const remarkCount = (d: VisitDevice) => d.current?.items.filter((i) => i.comment?.trim()).length ?? 0;

/** Окну проверки нужна техника в привычном виде. */
const asDevice = (d: VisitDevice, clientId: number): Device => ({
  id: d.id,
  clientId,
  deviceTypeId: 0,
  deviceType: d.deviceType,
  brandId: null,
  brand: null,
  modelId: null,
  model: null,
  serial: null,
  title: d.title,
  inventoryNo: d.inventoryNo,
  location: d.location,
  parentId: null,
});

/**
 * Выезд к клиенту: список его компьютеров и принтеров по отделам. Нажали на устройство, прошли его бланк
 * (у ПК свой, у принтера свой), оно загорелось зелёным. Замечания к пунктам окрашивают устройство жёлтым или красным.
 */
export function VisitDevices({ taskId, clientId, canEdit }: { taskId: number; clientId: number; canEdit: boolean }) {
  const q = useVisitDevices(taskId);
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useMemo(() => q.data ?? [], [q.data]);

  const groups = useMemo(() => {
    const m = new Map<string, VisitDevice[]>();
    for (const d of list) {
      const key = d.location?.trim() || 'Без отдела';
      m.set(key, [...(m.get(key) ?? []), d]);
    }
    return [...m.entries()];
  }, [list]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return null;

  const checked = list.filter((d) => d.current).length;
  const problems = list.filter((d) => ['warn', 'bad'].includes(stateOf(d))).length;
  const current = list.find((d) => d.id === openId) ?? null;
  const next = current ? list.slice(list.indexOf(current) + 1).find((d) => !d.current) : undefined;

  if (!list.length) {
    return (
      <EmptyState icon={<Monitor />} title="У клиента нет компьютеров и принтеров">
        Выезд проверяет технику по списку клиента. Добавьте компьютеры и принтеры в <Link to={`/clients/${clientId}?tab=service`}>карточке клиента</Link>.
      </EmptyState>
    );
  }

  return (
    <section>
      <h3 className={s.head}>
        <span>
          Техника клиента · проверено {checked} из {list.length}
        </span>
        {problems > 0 && <span className={s.problems}>замечания: {problems}</span>}
      </h3>
      {canEdit && <p className={s.hint}>Нажмите на устройство, отметьте пункты его бланка и сохраните. К любому пункту можно оставить комментарий.</p>}
      {groups.map(([place, devices]) => (
        <div key={place} className={s.group}>
          <h4 className={s.place}>{place}</h4>
          <ul className={s.list}>
            {devices.map((d) => {
              const st = stateOf(d);
              const Mark = MARK[st];
              const remarks = remarkCount(d);
              const sub = [d.hostName, d.current?.personName, remarks ? `замечаний: ${remarks}` : null].filter(Boolean).join(' · ');
              const body = (
                <>
                  <span className={s.mark} aria-hidden>
                    <Mark size={16} />
                  </span>
                  <span className={s.main}>
                    <b>
                      {d.kind === 'printer' && <Printer size={15} aria-hidden style={{ marginRight: 6, verticalAlign: '-2px' }} />}
                      {d.inventoryNo ? `${d.inventoryNo}: ` : ''}
                      {d.title}
                    </b>
                    <span className={s.sub}>{sub || (d.kind === 'printer' ? 'МФУ / принтер' : 'ПК')}</span>
                    <span className={s.state}>{STATE_TEXT[st]}</span>
                  </span>
                </>
              );
              return (
                <li key={d.id}>
                  {canEdit ? (
                    <button type="button" className={s.device} data-state={st} onClick={() => setOpenId(d.id)}>
                      {body}
                    </button>
                  ) : (
                    <div className={s.device} data-state={st}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <InspectionSheet
        device={current ? asDevice(current, clientId) : null}
        previous={current?.previous ?? null}
        initial={current?.current ?? null}
        taskId={taskId}
        onClose={() => setOpenId(null)}
        onNext={next ? () => setOpenId(next.id) : undefined}
      />
    </section>
  );
}
