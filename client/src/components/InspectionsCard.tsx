import { useMemo, useState } from 'react';
import { ClipboardCheck, FileDown } from 'lucide-react';
import { inspectionKindOf, type Device, type Inspection } from '@sd/shared';
import { useClientInspections } from '@/api/queries';
import { fmtDay } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Card, CardHead, EmptyState, Pill } from '@/ui/Display';
import { InspectionSheet } from './InspectionSheet';
import s from './InspectionsCard.module.css';

const monthOf = (d: string | Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Проверка парка на выезде: техника организации по отделам, у каждой единицы видно, проверена ли она
 * в этом месяце. Открывает бланк проверки и отдаёт готовый PDF за месяц.
 */
export function InspectionsCard({ clientId, devices }: { clientId: number; devices: Device[] }) {
  const q = useClientInspections(clientId);
  const [openId, setOpenId] = useState<number | null>(null);
  const month = monthOf(new Date());

  const rows = useMemo(() => {
    const last = new Map<number, Inspection>();
    for (const i of q.data ?? []) if (!last.has(i.deviceId)) last.set(i.deviceId, i);
    return devices
      .filter((d) => inspectionKindOf(d.deviceType))
      .sort(
        (a, b) =>
          (a.location ?? '').localeCompare(b.location ?? '', 'ru') ||
          (a.inventoryNo ?? '').localeCompare(b.inventoryNo ?? '', 'ru', { numeric: true }) ||
          a.id - b.id,
      )
      .map((d) => {
        const prev = last.get(d.id) ?? null;
        return { device: d, prev, checked: Boolean(prev && monthOf(prev.inspectedAt) === month) };
      });
  }, [devices, q.data, month]);

  const checkedCount = rows.filter((r) => r.checked).length;
  const current = rows.find((r) => r.device.id === openId) ?? null;
  const next = current ? rows.find((r) => !r.checked && r.device.id !== current.device.id && rows.indexOf(r) > rows.indexOf(current)) : null;

  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.device.location?.trim() || 'Без отдела';
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <Card>
      <CardHead title="Проверка техники" count={rows.length}>
        <div className="row wrap">
          <a className={s.pdf} href={`/api/documents/inspection-blank/pc.pdf`} target="_blank" rel="noreferrer">
            <FileDown size={16} aria-hidden /> Бланк ПК
          </a>
          <a className={s.pdf} href={`/api/documents/inspection-blank/printer.pdf`} target="_blank" rel="noreferrer">
            <FileDown size={16} aria-hidden /> Бланк МФУ
          </a>
          {checkedCount > 0 && (
            <a className={s.pdf} href={`/api/documents/inspections/client/${clientId}.pdf?month=${month}`} target="_blank" rel="noreferrer">
              <FileDown size={16} aria-hidden /> Результаты за месяц
            </a>
          )}
        </div>
      </CardHead>
      {rows.length ? (
        <>
          <p className="muted" style={{ marginBottom: 'var(--s-3)' }}>
            Проверено в этом месяце: {checkedCount} из {rows.length}. Нажмите на технику, отметьте пункты бланка и сохраните.
          </p>
          {groups.map(([place, list]) => (
            <section key={place} className={s.group}>
              <h3 className={s.place}>{place}</h3>
              <ul className={s.list}>
                {list.map(({ device: d, prev, checked }) => (
                  <li key={d.id} className={s.row}>
                    <div className={s.main}>
                      <b>
                        {d.inventoryNo ? `${d.inventoryNo}: ` : ''}
                        {d.title}
                      </b>
                      <span className="muted">
                        {prev
                          ? `проверено ${fmtDay(prev.inspectedAt)}${prev.performerName ? `, ${prev.performerName}` : ''}${prev.personName ? `, ${prev.personName}` : ''}`
                          : 'ещё не проверялось'}
                      </span>
                    </div>
                    <div className={s.side}>
                      <Pill tone={checked ? 'teal' : 'outline'}>{checked ? 'в этом месяце' : 'не проверено'}</Pill>
                      <Button
                        size="sm"
                        variant={checked ? 'secondary' : 'primary'}
                        icon={<ClipboardCheck size={16} aria-hidden />}
                        onClick={() => setOpenId(d.id)}
                      >
                        {checked ? 'Ещё раз' : 'Проверить'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <EmptyState icon={<ClipboardCheck />} title="Нет техники для проверки">
          Бланки есть у компьютеров, ноутбуков, принтеров и МФУ. Они появятся здесь после приёма или импорта.
        </EmptyState>
      )}
      <InspectionSheet
        device={current?.device ?? null}
        previous={current?.prev ?? null}
        onClose={() => setOpenId(null)}
        onNext={next ? () => setOpenId(next.device.id) : undefined}
      />
    </Card>
  );
}
