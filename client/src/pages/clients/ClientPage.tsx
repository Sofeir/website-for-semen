import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Printer,
  Save,
  UserRound,
} from 'lucide-react';
import { formatPhone, type FleetRowDto } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useClient, useInvalidate, useServiceChecklist } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { AttachHint, AttachmentList, UploadButton } from '@/components/Attachments';
import { ChecklistEditor } from '@/components/ChecklistEditor';
import { ClientFormSheet } from '@/components/ClientFormSheet';
import { FleetEditor, emptyFleetRow, fleetTotals } from '@/components/FleetEditor';
import { OrderRow } from '@/components/OrderRow';
import { ServicePlanCard } from '@/components/ServicePlanCard';
import { TaskFormSheet } from '@/components/TaskFormSheet';
import { TaskRow } from '@/components/TaskRow';
import { TaskSheet } from '@/components/TaskSheet';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHead, EmptyState, ErrorBox, Pill, Spinner, Tabs } from '@/ui/Display';
import { useToast } from '@/ui/Toast';
import s from './ClientPage.module.css';

type Tab = 'orders' | 'devices' | 'docs' | 'tasks' | 'fleet' | 'service';

export default function ClientPage() {
  const id = Number(useParams().id);
  const q = useClient(id);
  const c = q.data;
  const { can } = useAuth();
  const inv = useInvalidate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'service' ? 'service' : 'orders');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [fleet, setFleet] = useState<FleetRowDto[]>([]);
  const [savingFleet, setSavingFleet] = useState(false);
  const service = useServiceChecklist(id);
  const [works, setWorks] = useState<string[]>([]);
  const [savingWorks, setSavingWorks] = useState(false);
  const [visit, setVisit] = useState(false);
  useEffect(() => {
    if (service.data) setWorks(service.data.items);
  }, [service.data]);
  useDocumentTitle(c?.name ?? 'Клиент');

  useEffect(() => {
    if (c) setFleet(c.fleet.length ? c.fleet : [emptyFleetRow()]);
  }, [c]);

  if (q.isLoading) return <Spinner />;
  if (q.isError || !c) return <ErrorBox error={q.error} />;

  const legal = c.kind === 'legal';
  const active = c.orders.filter((o) => !o.issuedAt);
  const totals = fleetTotals(c.fleet);

  const saveFleet = async () => {
    setSavingFleet(true);
    try {
      await api.put(`/clients/${c.id}/fleet`, { rows: fleet.filter((r) => r.department.trim()) });
      toast.success('Чек-лист сохранён');
      inv('client');
    } catch (e) {
      toast.error('Не сохранилось', (e as ApiError).message);
    } finally {
      setSavingFleet(false);
    }
  };

  const saveWorks = async () => {
    setSavingWorks(true);
    try {
      await api.put(`/clients/${c.id}/service-checklist`, { items: works.map((x) => x.trim()).filter(Boolean) });
      toast.success('Список работ сохранён');
      inv('serviceChecklist');
    } catch (e) {
      toast.error('Не сохранилось', (e as ApiError).message);
    } finally {
      setSavingWorks(false);
    }
  };

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'orders', label: 'Заявки', count: c.orders.length },
    { value: 'devices', label: 'Техника', count: c.devices.length },
    { value: 'docs', label: 'Документы', count: c.documents.length + c.attachments.length },
    { value: 'tasks', label: 'Задачи', count: c.tasks.filter((t) => t.status === 'open').length },
  ];
  if (legal) tabs.push({ value: 'fleet', label: 'Парк техники', count: totals.pc + totals.mfu });
  tabs.push({ value: 'service', label: 'Выезд', count: service.data?.items.length });

  return (
    <div>
      <Link to="/clients" className={s.back}>
        <ArrowLeft size={18} aria-hidden />
        Все клиенты
      </Link>

      <header className={s.head}>
        <span className={s.avatar}>{legal ? <Building2 aria-hidden /> : <UserRound aria-hidden />}</span>
        <div className={s.headMain}>
          <div className={s.tags}>
            <Pill tone={legal ? 'violet' : 'blue'}>{legal ? 'Юрлицо' : 'Физлицо'}</Pill>
            {active.length > 0 && <Pill tone="amber">в работе: {active.length}</Pill>}
          </div>
          <h1 className={s.title}>{c.name}</h1>
          <ul className={s.contacts}>
            {c.phone && (
              <li>
                <a href={`tel:+${c.phone.replace(/\D/g, '')}`}>
                  <Phone aria-hidden />
                  {formatPhone(c.phone)}
                </a>
              </li>
            )}
            {c.phone2 && (
              <li>
                <a href={`tel:${c.phone2.replace(/[^\d+]/g, '')}`}>
                  <Phone aria-hidden />
                  {formatPhone(c.phone2)}
                </a>
              </li>
            )}
            {c.email && (
              <li>
                <a href={`mailto:${c.email}`}>
                  <Mail aria-hidden />
                  {c.email}
                </a>
              </li>
            )}
            {c.address && (
              <li>
                <MapPin aria-hidden />
                {c.address}
              </li>
            )}
            {c.contactPerson && (
              <li>
                <UserRound aria-hidden />
                {c.contactPerson}
              </li>
            )}
            {c.inn && (
              <li>
                ИНН {c.inn}
                {c.kpp && `, КПП ${c.kpp}`}
              </li>
            )}
          </ul>
          {c.note && <p className={s.note}>{c.note}</p>}
        </div>
        <div className={s.headActions}>
          {can('intake.create') && (
            <ButtonLink to={`/intake?client=${c.id}`} icon={<Plus size={18} aria-hidden />}>
              Принять технику
            </ButtonLink>
          )}
          {can('clients.edit') && (
            <Button variant="secondary" icon={<Pencil size={18} aria-hidden />} onClick={() => setEditing(true)}>
              Изменить
            </Button>
          )}
        </div>
      </header>

      <div className={s.tabs}>
        <Tabs label="Разделы карточки" items={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'orders' && (
        <Card>
          {c.orders.length ? (
            c.orders.map((o) => <OrderRow key={o.id} order={o} />)
          ) : (
            <EmptyState icon={<FileText />} title="Заявок ещё не было" />
          )}
        </Card>
      )}

      {tab === 'devices' && (
        <Card>
          {c.devices.length ? (
            <ul className={s.devices}>
              {c.devices.map((d) => {
                const orders = c.orders.filter((o) => o.deviceTitle === d.title);
                return (
                  <li key={d.id} className={s.device}>
                    <b>{d.title}</b>
                    <span>
                      {d.serial ? `S/N ${d.serial}` : 'серийный номер не указан'}
                      {orders.length ? `, обращений: ${orders.length}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<FileText />} title="Техники нет" />
          )}
        </Card>
      )}

      {tab === 'docs' && (
        <div className={s.docsGrid}>
          <Card>
            <CardHead title="Квитанции и акты" count={c.documents.length} />
            {c.documents.length ? (
              <ul className={s.docs}>
                {c.documents.map((d) => (
                  <li key={`${d.kind}${d.id}`} className={s.doc}>
                    {d.kind === 'act' ? <FileText aria-hidden /> : <Printer aria-hidden />}
                    {d.kind === 'act' ? (
                      <Link to={`/acts/${d.id}`} className={s.docMain}>
                        <b>Акт №{d.number}</b>
                        <span>
                          заявка №{d.orderNumber}, {fmtWhen(d.createdAt)}
                        </span>
                      </Link>
                    ) : (
                      <span className={s.docMain}>
                        <b>Квитанция о приёме</b>
                        <span>
                          №{d.orderNumber}, {fmtWhen(d.createdAt)}
                        </span>
                      </span>
                    )}
                    <a href={d.url} target="_blank" rel="noreferrer" className={s.pdf}>
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Документов пока нет.</p>
            )}
          </Card>
          <Card>
            <CardHead title="Файлы" count={c.attachments.length}>
              <UploadButton target={{ clientId: c.id }} onUploaded={() => inv('client')} label="Добавить" />
            </CardHead>
            {c.attachments.length ? <AttachmentList items={c.attachments} onDeleted={() => inv('client')} /> : <AttachHint />}
          </Card>
        </div>
      )}

      {tab === 'tasks' && (
        <Card>
          {c.tasks.length ? (
            c.tasks.map((t) => <TaskRow key={t.id} task={t} onOpen={() => setTaskId(t.id)} showAssignee />)
          ) : (
            <EmptyState icon={<FileText />} title="Задач нет" />
          )}
        </Card>
      )}

      {tab === 'fleet' && legal && (
        <Card>
          <CardHead title="Чек-лист парка техники">
            {can('clients.edit') && (
              <Button size="sm" icon={<Save size={16} aria-hidden />} loading={savingFleet} onClick={saveFleet}>
                Сохранить
              </Button>
            )}
          </CardHead>
          <FleetEditor rows={fleet} onChange={setFleet} />
        </Card>
      )}

      {tab === 'service' && (
        <Card>
          <CardHead title="Работы на выезде">
            <div className="row wrap">
              {can('clients.edit') && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Save size={16} aria-hidden />}
                  loading={savingWorks}
                  onClick={saveWorks}
                >
                  Сохранить список
                </Button>
              )}
              {can('tasks.create') && (
                <Button size="sm" icon={<CalendarCheck size={16} aria-hidden />} onClick={() => setVisit(true)}>
                  Назначить выезд
                </Button>
              )}
            </div>
          </CardHead>
          <p className="muted" style={{ marginBottom: 'var(--s-4)' }}>
            Что специалист делает у клиента на каждом обслуживании. При назначении выезда этот список становится чек-листом в
            задаче, и специалист отмечает пункты на месте.
          </p>
          <ChecklistEditor items={works} onChange={setWorks} disabled={!can('clients.edit')} />
        </Card>
      )}
      {tab === 'service' && (
        <div style={{ marginTop: 'var(--s-4)' }}>
          <ServicePlanCard clientId={c.id} />
        </div>
      )}

      <TaskFormSheet
        open={visit}
        onClose={() => setVisit(false)}
        clientId={c.id}
        presetTitle={`Выезд: ${c.name}`}
        presetChecklist={works.map((x) => x.trim()).filter(Boolean)}
      />
      <ClientFormSheet open={editing} onClose={() => setEditing(false)} client={c} />
      <TaskSheet taskId={taskId} onClose={() => setTaskId(null)} />
    </div>
  );
}
