import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarCheck, Tags } from 'lucide-react';
import type { TaskListItem } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { useTaskKinds, useTasks } from '@/api/queries';
import { addDays, fmtDay, fmtWeekday, sameDay, startOfDay } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { KindsSheet } from '@/components/KindsSheet';
import { UserSelect } from '@/components/Pickers';
import { TaskRow } from '@/components/TaskRow';
import { TaskSheet } from '@/components/TaskSheet';
import { Button, IconButton, cx } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from '@/ui/Display';
import { ChipGroup, Segmented } from '@/ui/Form';
import s from './CalendarPage.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

/** Сетка месяца с понедельника: 6 недель, чтобы высота не прыгала. */
function monthGrid(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7;
  const start = addDays(first, -shift);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * Календарь собирается из задач автоматически: задача стоит в дне своего срока.
 * Вручную календарь не заполняется.
 */
export default function CalendarPage() {
  useDocumentTitle('Календарь');
  const { can } = useAuth();
  const [cursor, setCursor] = useState(() => startOfDay());
  const [selected, setSelected] = useState(() => startOfDay());
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [assignee, setAssignee] = useState('');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [kindNames, setKindNames] = useState<string[]>([]);
  const [kindsOpen, setKindsOpen] = useState(false);
  const kinds = useTaskKinds();
  const kindOptions = (kinds.data ?? []).filter((k) => k.isActive).map((k) => k.name);
  const days = useMemo(() => monthGrid(cursor), [cursor]);
  const from = days[0];
  const to = addDays(days[41], 1);
  const tasks = useTasks({
    scope: scope === 'all' ? 'all' : 'mine',
    status: 'any',
    from: from.toISOString(),
    to: to.toISOString(),
    assignee: assignee ? Number(assignee) : '',
  });

  const byDay = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    for (const t of tasks.data ?? []) {
      if (kindNames.length && !kindNames.includes(t.kindName ?? '')) continue;
      const key = startOfDay(new Date(t.dueAt)).toDateString();
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks.data, kindNames]);

  const today = startOfDay();
  const dayTasks = byDay.get(selected.toDateString()) ?? [];
  const shiftMonth = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <>
      <PageHeader
        title="Календарь"
        subtitle="Строится из сроков задач. Заполнять вручную не нужно."
        actions={
          can('tasks.manageAll') ? (
            <Segmented
              label="Чьи задачи"
              layoutId="cal-scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'mine', label: 'Мои' },
                { value: 'all', label: 'Все' },
              ]}
            />
          ) : undefined
        }
      />

      <div className={s.layout}>
        <Card className={s.monthCard}>
          <div className={s.monthHead}>
            <IconButton label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>
              <ChevronLeft />
            </IconButton>
            <h2 className={s.monthTitle}>{capitalize(monthFmt.format(cursor))}</h2>
            <IconButton label="Следующий месяц" onClick={() => shiftMonth(1)}>
              <ChevronRight />
            </IconButton>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCursor(today);
                setSelected(today);
              }}
            >
              Сегодня
            </Button>
          </div>
          {scope === 'all' && (
            <div className={s.assignee}>
              <UserSelect
                aria-label="Сотрудник"
                placeholder="Все сотрудники"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              />
            </div>
          )}
          <div className={s.kinds}>
            <ChipGroup label="Виды задач" options={kindOptions} value={kindNames} onChange={setKindNames} />
            <Button variant="ghost" size="sm" icon={<Tags size={18} aria-hidden />} onClick={() => setKindsOpen(true)}>
              Виды
            </Button>
          </div>
          {tasks.isError && <ErrorBox error={tasks.error} />}
          <div className={s.grid} role="grid" aria-label={monthFmt.format(cursor)}>
            {WEEKDAYS.map((w) => (
              <div key={w} className={s.weekday} role="columnheader">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const list = byDay.get(d.toDateString()) ?? [];
              const open = list.filter((t) => t.status === 'open');
              const late = open.some((t) => t.overdue);
              const isSel = sameDay(d, selected);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  role="gridcell"
                  aria-selected={isSel}
                  aria-label={`${fmtDay(d)}: задач ${list.length}`}
                  className={cx(
                    s.day,
                    d.getMonth() !== cursor.getMonth() && s.outside,
                    sameDay(d, today) && s.today,
                    isSel && s.selected,
                    (d.getDay() === 0 || d.getDay() === 6) && s.weekend,
                  )}
                  onClick={() => setSelected(startOfDay(d))}
                >
                  <span className={s.dayNum}>{d.getDate()}</span>
                  {list.length > 0 && (
                    <>
                      <span className={s.dots} aria-hidden>
                        {list.slice(0, 4).map((t) => (
                          <span
                            key={t.id}
                            className={cx(s.dot, t.status !== 'open' ? s.dotDone : t.overdue ? s.dotLate : s.dotOpen)}
                          />
                        ))}
                      </span>
                      <span className={s.chips} aria-hidden>
                        {list.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className={cx(s.chip, t.status !== 'open' ? s.chipDone : t.overdue ? s.chipLate : s.chipOpen)}
                          >
                            {t.title}
                          </span>
                        ))}
                        {list.length > 3 && <span className={s.moreChip}>ещё {list.length - 3}</span>}
                      </span>
                      {late && <span className="visually-hidden">есть просроченные</span>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {tasks.isFetching && !tasks.data && <Spinner />}
        </Card>

        <Card className={s.agenda}>
          <h2 className={s.agendaTitle}>
            {sameDay(selected, today) ? 'Сегодня' : capitalize(fmtWeekday(selected))}, {fmtDay(selected)}
          </h2>
          {dayTasks.length ? (
            dayTasks.map((t) => <TaskRow key={t.id} task={t} onOpen={() => setTaskId(t.id)} showAssignee={scope === 'all'} />)
          ) : (
            <EmptyState icon={<CalendarCheck />} title="Задач со сроком на этот день нет" />
          )}
        </Card>
      </div>

      <TaskSheet taskId={taskId} onClose={() => setTaskId(null)} />
      <KindsSheet open={kindsOpen} onClose={() => setKindsOpen(false)} />
    </>
  );
}

const capitalize = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
