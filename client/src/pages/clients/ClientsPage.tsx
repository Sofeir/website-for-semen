import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Search, UserPlus, UserRound, Users } from 'lucide-react';
import { formatPhone } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { useClients } from '@/api/queries';
import { useDebounced, useDocumentTitle, useIsDesktop } from '@/lib/hooks';
import { ClientFormSheet } from '@/components/ClientFormSheet';
import { ArrowLink, Button } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner, Tabs } from '@/ui/Display';
import { Input } from '@/ui/Form';
import s from './Clients.module.css';

type KindTab = 'all' | 'person' | 'legal';
const PAGE = 50;

export default function ClientsPage() {
  useDocumentTitle('Клиенты');
  const { can } = useAuth();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [tab, setTab] = useState<KindTab>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q.trim(), 250);
  const clients = useClients({ q: dq, kind: tab === 'all' ? undefined : tab, limit });
  const items = clients.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Клиенты"
        subtitle={clients.data ? `${clients.data.total} в базе` : undefined}
        actions={
          can('clients.edit') && (
            <Button size="sm" icon={<UserPlus size={18} aria-hidden />} onClick={() => setCreating(true)}>
              Новый клиент
            </Button>
          )
        }
      />
      <div className={s.toolbar}>
        <Tabs
          label="Тип клиентов"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setLimit(PAGE);
          }}
          items={[
            { value: 'all', label: 'Все' },
            { value: 'person', label: 'Физлица' },
            { value: 'legal', label: 'Юрлица' },
          ]}
        />
        <Input
          icon={<Search aria-hidden />}
          type="search"
          placeholder="Имя, ФИО сотрудника, телефон, ИНН, номер техники"
          aria-label="Поиск клиентов"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
          className={s.search}
        />
      </div>

      {clients.isError ? (
        <ErrorBox error={clients.error} />
      ) : !clients.data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<Users />} title={dq ? 'Никого не нашли' : 'Клиентов пока нет'}>
            {dq ? 'Проверьте написание или поищите по телефону.' : 'Клиенты появятся после первого приёма или импорта из Excel.'}
          </EmptyState>
        </Card>
      ) : desktop ? (
        <div className={s.tableCard}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Клиент</th>
                <th scope="col">Телефон</th>
                <th scope="col">ИНН</th>
                <th scope="col">Заявки</th>
                <th scope="col">
                  <span className="visually-hidden">Открыть</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <span className={s.nameCell}>
                      <span className={s.icon}>{c.kind === 'legal' ? <Building2 aria-hidden /> : <UserRound aria-hidden />}</span>
                      <span>
                        <b>{c.name}</b>
                        {c.contactPerson && <span className={s.subLine}>{c.contactPerson}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="num">{formatPhone(c.phone) || '—'}</td>
                  <td className="num">{c.inn || '—'}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="num">{c.ordersCount ?? 0}</span>
                      {Boolean(c.activeCount) && <Pill tone="blue">в работе {c.activeCount}</Pill>}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <ArrowLink to={`/clients/${c.id}`} label={`Открыть ${c.name}`} light />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Card className={s.mobileList}>
          {items.map((c) => (
            <Link key={c.id} to={`/clients/${c.id}`} className={s.mobileItem}>
              <span className={s.icon}>{c.kind === 'legal' ? <Building2 aria-hidden /> : <UserRound aria-hidden />}</span>
              <span className={s.mobileMain}>
                <b>{c.name}</b>
                <span>{[formatPhone(c.phone), c.contactPerson, c.inn && `ИНН ${c.inn}`].filter(Boolean).join(', ')}</span>
              </span>
              {Boolean(c.activeCount) && <Pill tone="blue">{c.activeCount}</Pill>}
            </Link>
          ))}
        </Card>
      )}

      {clients.data && items.length < clients.data.total && (
        <div className={s.more}>
          <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)} loading={clients.isFetching}>
            Показать ещё
          </Button>
        </div>
      )}

      <ClientFormSheet open={creating} onClose={() => setCreating(false)} defaultKind={tab === 'legal' ? 'legal' : 'person'} />
    </>
  );
}
