import { Check } from 'lucide-react';
import type { Stage } from '@sd/shared';
import { cx } from '@/ui/Button';
import s from './StageRail.module.css';

/** Путь заявки по этапам: пройденные, текущий, следующие. Порядок строгий, поэтому нумерация. */
export function StageRail({ stages, currentId }: { stages: Stage[]; currentId: number }) {
  const idx = stages.findIndex((st) => st.id === currentId);
  const current = stages[idx];
  return (
    <div className={s.wrap}>
      <ol className={s.rail} aria-label="Этапы ремонта">
        {stages.map((st, i) => {
          const state = i < idx || current?.isFinal ? 'done' : i === idx ? 'current' : 'todo';
          return (
            <li key={st.id} className={cx(s.step, s[state])} aria-current={state === 'current' ? 'step' : undefined}>
              <span className={s.bar} aria-hidden />
              <span className={s.label}>
                <span className={s.num}>
                  {state === 'done' ? <Check size={12} strokeWidth={3} aria-hidden /> : String(i + 1).padStart(2, '0')}
                </span>
                <span className={s.name}>{st.name}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {current && (
        <p className={s.mobileCurrent}>
          Этап {idx + 1} из {stages.length}: <b>{current.name}</b>
        </p>
      )}
    </div>
  );
}
