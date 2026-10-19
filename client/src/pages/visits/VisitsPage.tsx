import { useState } from 'react';
import { CalendarCheck, CalendarPlus, Truck } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useServiceChecklist, useVisits } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { ClientPickSheet, type PickedClient } from '@/components/ClientPickSheet';
import { UserSelect } from '@/components/Pickers';
import { ServicePlanCard } from '@/components/ServicePlanCard';
import { TaskFormSheet } from '@/components/TaskFormSheet';
import { TaskRow } from '@/components/TaskRow';
import { TaskSheet } from '@/components/TaskSheet';
import { VisitsList } from '@/components/VisitsList';
import { Button } from '@/ui/Button';
import { Card, CardHead, EmptyState, ErrorBox, PageHeader, Spinner } from '@/ui/Display';
import { Segmented } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import s from './VisitsPage.module.css';

type Status = 'open' | 'done';
type Picking = 'visit' | 'plan' | null;

/**
 * Все выезды к клиентам в одном месте: назначенные задачи-выезды и графики регулярных выездов.
 * Руководитель видит всех сотрудников и может отфильтровать по одному, остальные — свои выезды.
 */
export default function VisitsPage() {
  useDocumentTitle('Выезды');
  const { can } = useAuth();
  const all = can('tasks.manageAll');
  const [status, setStatus] = useState<Status>('open');
  const [assignee, setAssignee] = useState('');
  const visits = useVisits({ status, assignee: all ? assignee : '' });
  const [openTask, setOpenTask] = useState<number | null>(null);

  const [picking, setPicking] = useState<Picking>(null);
  const [visitFor, setVisitFor] = useState<PickedClient | null>(null);
  const [planFor, setPlanFor] = useState<PickedClient | null>(null);
  const works = useServiceChecklist(visitFor?.id ?? 0);

  const pick = (c: PickedClient) => {
    if (picking === 'visit') setVisitFor(c);
    else setPlanFor(c);
    setPicking(null);
  };

  const d = visits.data;
  return (
    <>
      <PageHeader
        title="Выезды"
        subtitle={all ? 'Выезды всех сотрудников к клиентам' : 'Ваши выезды к клиентам'}
        actions={
          <div className={s.actions}>
            {can('clients.edit') && (
              <Button
                size="sm"
                variant="secondary"
                icon={<CalendarPlus size={18} aria-hidden />}
                onClick={() => setPicking('plan')}
              >
                Добавить график
              </Button>
            )}
            <Button size="sm" icon={<CalendarCheck size={18} aria-hidden />} onClick={() => setPicking('visit')}>
              Назначить выезд
            </Button>
          </div>
        }
      />

      <div className={s.toolbar}>
        <Segmented
          label="Какие выезды"
          layoutId="visit-status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Предстоящие' },
            { value: 'done', label: 'Завершённые' },
          ]}
        />
        {all && (
          <UserSelect
            aria-label="Сотрудник"
            placeholder="Все сотрудники"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            preferRoles={['master', 'diagnostician']}
          />
        )}
      </div>

      {visits.isError ? (
        <ErrorBox error={visits.error} />
      ) : !d ? (
        <Spinner />
      ) : (
        <div className={s.cols}>
          <Card>
            <CardHead title={status === 'open' ? 'Назначенные выезды' : 'Завершённые выезды'} count={d.tasks.length} />
            {d.tasks.length ? (
              <div className={s.list}>
                {d.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setOpenTask(t.id)} showAssignee={all} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Truck />} title={status === 'open' ? 'Назначенных выездов нет' : 'Завершённых выездов нет'}>
                {status === 'open'
                  ? 'Выезды по графику появятся здесь накануне. Разовый выезд — кнопка «Назначить выезд».'
                  : 'Здесь будут закрытые задачи-выезды.'}
              </EmptyState>
            )}
          </Card>
          {status === 'open' && (
            <Card>
              <CardHead title="По графику" count={d.plans.length} />
              <VisitsList plans={d.plans} />
            </Card>
          )}
        </div>
      )}

      <ClientPickSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={pick}
        title={picking === 'plan' ? 'График выездов: клиент' : 'Выезд: к какому клиенту'}
      />
      <TaskFormSheet
        open={Boolean(visitFor) && !works.isLoading}
        onClose={() => setVisitFor(null)}
        clientId={visitFor?.id}
        presetTitle={visitFor ? `Выезд: ${visitFor.name}` : undefined}
        presetChecklist={works.data?.items}
        visit
      />
      <Sheet open={Boolean(planFor)} onClose={() => setPlanFor(null)} title="График выездов" subtitle={planFor?.name} width={620}>
        {planFor && <ServicePlanCard clientId={planFor.id} bare onSaved={() => setPlanFor(null)} />}
      </Sheet>
      <TaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
    </>
  );
}
