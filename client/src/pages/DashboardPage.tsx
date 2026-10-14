import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Inbox, PackageCheck, Plus } from 'lucide-react';
import { useAuth, useMe } from '@/app/auth';
import { useCloseTasks, useDashboard, useSettings } from '@/api/queries';
import { fmtDay, fmtWeekday } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { OrderRow } from '@/components/OrderRow';
import { TaskRow } from '@/components/TaskRow';
import { TaskSheet } from '@/components/TaskSheet';
import { TaskFormSheet } from '@/components/TaskFormSheet';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHead, EmptyState, ErrorBox, PageHeader, Plate, Skeleton } from '@/ui/Display';
import { useToast } from '@/ui/Toast';
import { ApiError } from '@/api/http';
import s from './DashboardPage.module.css';

export default function DashboardPage() {
  useDocumentTitle('Сегодня');
  const me = useMe();
  const { can } = useAuth();
  const q = useDashboard();
  const settings = useSettings();
  const closeTasks = useCloseTasks();
  const toast = useToast();
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [newTask, setNewTask] = useState(false);
  const now = new Date();
  const d = q.data;

  const quickClose = async (id: number) => {
    try {
      await closeTasks.mutateAsync({ ids: [id], comment: null });
      toast.success('Задача закрыта');
    } catch (e) {
      toast.error('Не получилось закрыть', (e as ApiError).message);
    }
  };

  const stats = d
    ? [
        { label: 'Мои задачи на сегодня', value: d.counts.today, to: '/tasks' },
        {
          label: d.overdueScope === 'all' ? 'Просрочено у всех' : 'Просрочено у меня',
          value: d.counts.overdue,
          to: '/tasks?overdue=1',
          alert: d.counts.overdue > 0,
        },
        { label: 'Техника в работе', value: d.counts.inWork, to: '/orders' },
        { label: 'Готово к выдаче', value: d.counts.ready, to: '/orders?view=list&stage=ready', ok: true },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={`Сегодня, ${fmtDay(now)}`}
        subtitle={`${capitalize(fmtWeekday(now))}. Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}.`}
        actions={
          <Button variant="secondary" size="sm" icon={<Plus size={18} aria-hidden />} onClick={() => setNewTask(true)}>
            Поставить задачу
          </Button>
        }
      />

      {q.isError && <ErrorBox error={q.error} />}

      <Plate className={s.plate}>
        <p className={s.greeting}>
          {greeting(now)}, {me.fullName.split(' ')[0]}
        </p>
        <div className={s.stats}>
          {(d ? stats : Array.from({ length: 4 }, () => null)).map((st, i) =>
            st ? (
              <Link key={st.label} to={st.to} className={s.stat}>
                <span className={`${s.statValue} ${st.alert ? s.statAlert : ''} ${st.ok && st.value ? s.statOk : ''}`}>
                  {st.value}
                </span>
                <span className={s.statLabel}>{st.label}</span>
              </Link>
            ) : (
              <div key={i} className={s.stat}>
                <Skeleton h={40} w={60} />
              </div>
            ),
          )}
        </div>
      </Plate>

      <div className={s.grid}>
        <div className={s.col}>
          <Card>
            <CardHead title="Мои задачи на сегодня" count={d?.myTasksToday.length}>
              <Link to="/tasks" className={s.more}>
                Все задачи
              </Link>
            </CardHead>
            {!d ? (
              <ListSkeleton />
            ) : d.myTasksToday.length ? (
              <div className={s.list}>
                {d.myTasksToday.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={() => setOpenTask(t.id)}
                    onToggle={() => quickClose(t.id)}
                    checkLabel={`Закрыть задачу: ${t.title}`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={<CheckCircle2 />} title="На сегодня всё">
                Новые задачи появятся здесь и в колокольчике.
              </EmptyState>
            )}
          </Card>
          <Card>
            <CardHead title="Готово к выдаче" count={d?.readyOrders.length} />
            {!d ? (
              <ListSkeleton />
            ) : d.readyOrders.length ? (
              <div className={s.list}>
                {d.readyOrders.map((o) => (
                  <OrderRow key={o.id} order={o} showStage={false} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<PackageCheck />} title="Пока нечего выдавать">
                Когда мастер переведёт заявку в «Готово», она появится здесь.
              </EmptyState>
            )}
          </Card>
        </div>
        <div className={s.col}>
          <Card>
            <CardHead title={d?.overdueScope === 'all' ? 'Просрочено у всех' : 'Просрочено'} count={d?.overdue.length} />
            {!d ? (
              <ListSkeleton />
            ) : d.overdue.length ? (
              <div className={s.list}>
                {d.overdue.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setOpenTask(t.id)} showAssignee={d.overdueScope === 'all'} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<CheckCircle2 />} title="Просрочек нет">
                Все задачи укладываются в сроки.
              </EmptyState>
            )}
          </Card>
          <Card>
            <CardHead title="Новые заявки" count={d?.newOrders.length}>
              <Link to="/orders" className={s.more}>
                Все заявки
              </Link>
            </CardHead>
            {!d ? (
              <ListSkeleton />
            ) : d.newOrders.length ? (
              <div className={s.list}>
                {d.newOrders.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Inbox />}
                title="За два дня новых заявок нет"
                action={
                  can('intake.create') ? (
                    <ButtonLink to="/intake" icon={<ClipboardList size={18} aria-hidden />}>
                      Принять технику
                    </ButtonLink>
                  ) : undefined
                }
              />
            )}
          </Card>
        </div>
      </div>

      <TaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      <TaskFormSheet open={newTask} onClose={() => setNewTask(false)} />
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Skeleton h={44} />
      <Skeleton h={44} />
      <Skeleton h={44} />
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}
