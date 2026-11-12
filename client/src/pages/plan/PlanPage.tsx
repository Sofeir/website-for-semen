import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Laptop, Plus, Trash2, Truck, UserMinus } from 'lucide-react';
import { useAuth, useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { ClientPickSheet, type PickedClient } from '@/components/ClientPickSheet';
import { UserSelect } from '@/components/Pickers';
import { Button, IconButton } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner } from '@/ui/Display';
import { Input } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import { label, monthShift, thisMonth } from '../reports/reportUtils';
import s from './PlanPage.module.css';

interface Visit {
  id: number;
  title: string;
  dueAt: string;
  mode: 'onsite' | 'remote';
  status: string;
}
interface PlanClient {
  id: number;
  name: string;
  assigned: boolean;
  others: string[];
  visits: Visit[];
}
interface Plan {
  userId: number;
  userName: string;
  month: string;
  clients: PlanClient[];
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Первое число месяца или сегодня, если месяц текущий: с него начинается выбор даты. */
function startDate(month: string) {
  const now = new Date();
  return thisMonth() === month ? ymd(now) : `${month}-01`;
}

const fmtVisit = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });

/**
 * План месяца: у сотрудника закреплены организации; в начале месяца он расставляет даты выезда или удалённого подключения,
 * и они сразу становятся задачами в календаре. На одну организацию можно несколько сотрудников. Руководитель видит и правит план любого сотрудника.
 */
export default function PlanPage() {
  useDocumentTitle('План месяца');
  const me = useMe();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const inv = useInvalidate();
  const [month, setMonth] = useState(thisMonth());
  const [user, setUser] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState<Record<number, string>>({});

  const forUser = can('tasks.manageAll') && user ? Number(user) : me.id;
  const q = useQuery({
    queryKey: ['plan', month, forUser],
    queryFn: () => api.get<Plan>(`/plan?month=${month}${forUser !== me.id ? `&user=${forUser}` : ''}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['plan'] });
    inv('tasks', 'dashboard', 'visits', 'clients');
  };
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      refresh();
      if (done) toast.success(done);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const assign = (c: PickedClient) => {
    setPicking(false);
    void act(() => api.put('/plan/clients', { clientId: c.id, userId: forUser !== me.id ? forUser : undefined, assigned: true }), `«${c.name}» закреплена`);
  };
  const unassign = (c: PlanClient) =>
    act(() => api.put('/plan/clients', { clientId: c.id, userId: forUser !== me.id ? forUser : undefined, assigned: false }), `«${c.name}» откреплена`);
  const addVisit = (c: PlanClient, mode: 'onsite' | 'remote') => {
    const date = dates[c.id] || startDate(month);
    return act(async () => {
      const r = await api.post<{ created: number[]; skipped: number }>('/plan/visits', {
        clientId: c.id,
        userId: forUser !== me.id ? forUser : undefined,
        items: [{ date, mode }],
      });
      if (r.skipped) toast.error('Уже запланировано', 'На эту дату уже стоит такой выезд');
    }, undefined);
  };
  const removeVisit = (v: Visit) => act(() => api.del(`/plan/visits/${v.id}`), 'Убрано из плана');

  const [y, m] = month.split('-').map(Number);
  const maxDate = ymd(new Date(y!, m!, 0));
  const plan = q.data;

  return (
    <>
      <PageHeader
        title="План месяца"
        subtitle="Расставьте даты выезда или удалённого подключения по своим организациям: они сразу попадут в календарь и в задачи."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={() => setPicking(true)}>
            Закрепить организацию
          </Button>
        }
      />

      <div className={s.bar}>
        <div className={s.month}>
          <IconButton label="Прошлый месяц" onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft />
          </IconButton>
          <b>{label(month)}</b>
          <IconButton label="Следующий месяц" onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight />
          </IconButton>
        </div>
        {can('tasks.manageAll') && (
          <UserSelect aria-label="Чей план" placeholder="Мой план" value={user} onChange={(e) => setUser(e.target.value)} />
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBox error={q.error} />
      ) : !plan?.clients.length ? (
        <EmptyState
          icon={<CalendarPlus />}
          title="Организаций пока нет"
          action={
            <Button icon={<Plus size={18} aria-hidden />} onClick={() => setPicking(true)}>
              Закрепить организацию
            </Button>
          }
        >
          Закрепите за {forUser === me.id ? 'собой' : plan?.userName} организации, которые обслуживаете, и расставьте даты на месяц.
        </EmptyState>
      ) : (
        <div className={s.list}>
          {plan.clients.map((c) => (
            <Card key={c.id}>
              <div className={s.head}>
                <div className={s.name}>
                  <Link to={`/clients/${c.id}`}>
                    <b>{c.name}</b>
                  </Link>
                  {c.others.length > 0 && <span className="muted">также обслуживает: {c.others.join(', ')}</span>}
                  {!c.assigned && <Pill tone="outline">не закреплена</Pill>}
                </div>
                {c.assigned && (
                  <Button variant="ghost" size="sm" icon={<UserMinus size={16} aria-hidden />} disabled={busy} onClick={() => unassign(c)}>
                    Открепить
                  </Button>
                )}
              </div>

              {c.visits.length > 0 ? (
                <ul className={s.visits}>
                  {c.visits.map((v) => (
                    <li key={v.id} className={s.visit} data-done={v.status !== 'open'}>
                      <span className={s.date}>{fmtVisit(v.dueAt)}</span>
                      <Pill tone={v.mode === 'remote' ? 'violet' : 'amber'}>{v.mode === 'remote' ? 'удалённо' : 'выезд'}</Pill>
                      {v.status !== 'open' && <Pill tone="teal">проведён</Pill>}
                      {v.status === 'open' && (
                        <IconButton label="Убрать из плана" onClick={() => removeVisit(v)}>
                          <Trash2 />
                        </IconButton>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">На этот месяц дат пока нет.</p>
              )}

              <div className={s.add}>
                <Input
                  type="date"
                  aria-label={`Дата для ${c.name}`}
                  min={`${month}-01`}
                  max={maxDate}
                  value={dates[c.id] ?? startDate(month)}
                  onChange={(e) => setDates((d) => ({ ...d, [c.id]: e.target.value }))}
                />
                <Button variant="secondary" size="sm" icon={<Truck size={16} aria-hidden />} disabled={busy} onClick={() => addVisit(c, 'onsite')}>
                  Выезд
                </Button>
                <Button variant="secondary" size="sm" icon={<Laptop size={16} aria-hidden />} disabled={busy} onClick={() => addVisit(c, 'remote')}>
                  Удалённо
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ClientPickSheet open={picking} onClose={() => setPicking(false)} onPick={assign} title="Какую организацию закрепить" />
    </>
  );
}
