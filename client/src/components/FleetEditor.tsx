import { Plus, Trash2 } from 'lucide-react';
import type { FleetRowDto } from '@sd/shared';
import { Button, IconButton, cx } from '@/ui/Button';
import { Checkbox, Input } from '@/ui/Form';
import s from './FleetEditor.module.css';

export const emptyFleetRow = (): FleetRowDto => ({
  department: '',
  pcCount: 0,
  mfuCount: 0,
  reserve: false,
  ssdCheck: false,
  note: null,
});

export function fleetTotals(rows: FleetRowDto[]) {
  return rows.reduce(
    (t, r) => ({
      pc: t.pc + (Number(r.pcCount) || 0),
      mfu: t.mfu + (Number(r.mfuCount) || 0),
      reserve: t.reserve + (r.reserve ? 1 : 0),
      ssd: t.ssd + (r.ssdCheck ? 1 : 0),
    }),
    { pc: 0, mfu: 0, reserve: 0, ssd: 0 },
  );
}

/** Чек-лист парка техники юрлица по отделам. На телефоне — карточки, на широком экране — строки таблицы. */
export function FleetEditor({ rows, onChange }: { rows: FleetRowDto[]; onChange: (rows: FleetRowDto[]) => void }) {
  const update = (i: number, patch: Partial<FleetRowDto>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const totals = fleetTotals(rows);
  const num = (v: string) => Math.max(0, Math.min(100000, Number(v.replace(/\D/g, '')) || 0));

  return (
    <div className={s.wrap}>
      <div className={s.headRow} aria-hidden>
        <span>Отдел</span>
        <span>ПК</span>
        <span>МФУ</span>
        <span>Резервные</span>
        <span>Проверка SSD</span>
        <span>Заметка</span>
        <span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className={s.row}>
          <label className={cx(s.cell, s.dept)}>
            <span className={s.cellLabel}>Отдел</span>
            <Input
              value={r.department}
              placeholder="Например, бухгалтерия"
              onChange={(e) => update(i, { department: e.target.value })}
            />
          </label>
          <label className={s.cell}>
            <span className={s.cellLabel}>ПК</span>
            <Input
              inputMode="numeric"
              value={r.pcCount || ''}
              placeholder="0"
              onChange={(e) => update(i, { pcCount: num(e.target.value) })}
            />
          </label>
          <label className={s.cell}>
            <span className={s.cellLabel}>МФУ</span>
            <Input
              inputMode="numeric"
              value={r.mfuCount || ''}
              placeholder="0"
              onChange={(e) => update(i, { mfuCount: num(e.target.value) })}
            />
          </label>
          <div className={cx(s.cell, s.check)}>
            <Checkbox
              label={<span className={s.checkText}>Резервные</span>}
              checked={r.reserve}
              onChange={(e) => update(i, { reserve: e.target.checked })}
            />
          </div>
          <div className={cx(s.cell, s.check)}>
            <Checkbox
              label={<span className={s.checkText}>Проверка SSD</span>}
              checked={r.ssdCheck}
              onChange={(e) => update(i, { ssdCheck: e.target.checked })}
            />
          </div>
          <label className={cx(s.cell, s.noteCell)}>
            <span className={s.cellLabel}>Заметка</span>
            <Input value={r.note ?? ''} onChange={(e) => update(i, { note: e.target.value || null })} />
          </label>
          <div className={s.del}>
            <IconButton
              label={`Удалить отдел ${r.department || i + 1}`}
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              <Trash2 />
            </IconButton>
          </div>
        </div>
      ))}
      <div className={s.foot}>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={16} aria-hidden />}
          onClick={() => onChange([...rows, emptyFleetRow()])}
        >
          Добавить отдел
        </Button>
        <p className={s.totals} aria-live="polite">
          Итого: <b className="num">{totals.pc}</b> ПК, <b className="num">{totals.mfu}</b> МФУ
          {totals.reserve > 0 && `, резервные в ${totals.reserve}`}
          {totals.ssd > 0 && `, SSD проверить в ${totals.ssd}`}
        </p>
      </div>
    </div>
  );
}
