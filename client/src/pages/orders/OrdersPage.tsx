import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Columns3, Filter, Inbox, List, Search } from 'lucide-react';
import type { OrderListItem, Stage } from '@sd/shared';
import { useAuth, useMe } from '@/app/auth';
import { useDictionaries, useOrders } from '@/api/queries';
import { useDebounced, useDocumentTitle, useMediaQuery } from '@/lib/hooks';
import { AdvanceSheet, type AdvanceTarget } from '@/components/AdvanceSheet';
import { UserSelect } from '@/components/Pickers';
import { OrderRow } from '@/components/OrderRow';
import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from '@/ui/Display';
import { Checkbox, Input, Segmented, Select } from '@/ui/Form';
import { Kanban } from './Kanban';
import { OrdersTable } from './OrdersTable';
import s from './Orders.module.css';

export default function OrdersPage() {
  useDocumentTitle('Заявки');
  const { can } = useAuth();
  const me = useMe();
  // Таблица — только на широком экране, ниже — карточки.
  const desktop = useMediaQuery('(min-width: 1280px)');
  const dict = useDictionaries();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as 'kanban' | 'list') || 'kanban';
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q.trim(), 250);
  const [showFilters, setShowFilters] = useState(false);

  const stages = useMemo(() => (dict.data?.stages ?? []).filter((st) => st.isActive), [dict.data]);
  const stageParam = params.get('stage');
  const stageId = stageParam ? (stages.find((st) => st.code === stageParam || String(st.id) === stageParam)?.id ?? '') : '';

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filters = {
    q: dq,
    responsible: params.get('responsible') ? Number(params.get('responsible')) : ('' as const),
    kind: params.get('kind') ?? '',
    overdue: params.get('overdue') === '1',
    stage: view === 'list' ? stageId : ('' as const),
    issued: view === 'list' ? (params.get('issued') ?? '') : '',
    sort: params.get('sort') ?? '',
  };
  const orders = useOrders(filters);
  const [advance, setAdvance] = useState<{ order: AdvanceTarget; next: Stage } | null>(null);

  const startAdvance = (o: OrderListItem) => {
    const idx = stages.findIndex((st) => st.id === o.stageId);
    const next = stages[idx + 1];
    if (next) setAdvance({ order: o, next });
  };

  const canAdvance = (o: OrderListItem) => can('orders.advanceAny') || o.responsibleId === me.id;
  const activeFilters = [filters.responsible, filters.kind, filters.overdue].filter(Boolean).length;
  const filtersRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <PageHeader
        title="Заявки"
        subtitle={orders.data ? `${orders.data.length} в выборке` : undefined}
        actions={
          <>
            <Segmented
              label="Вид"
              layoutId="orders-view"
              value={view}
              onChange={(v) => set('view', v === 'kanban' ? null : v)}
              options={[
                { value: 'kanban', label: 'Этапы', icon: <Columns3 aria-hidden /> },
                { value: 'list', label: 'Список', icon: <List aria-hidden /> },
              ]}
            />
          </>
        }
      />

      <div className={s.toolbar}>
        <Input
          icon={<Search aria-hidden />}
          type="search"
          placeholder="Номер, клиент, телефон, модель, серийный №"
          aria-label="Поиск заявок"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            set('q', e.target.value || null);
          }}
          className={s.search}
        />
        <button type="button" className={s.filterToggle} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          <Filter size={18} aria-hidden />
          Фильтры{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <div className={s.filters} data-open={showFilters} ref={filtersRef}>
          <UserSelect
            aria-label="Ответственный"
            placeholder="Все сотрудники"
            value={params.get('responsible') ?? ''}
            onChange={(e) => set('responsible', e.target.value || null)}
          />
          <Select aria-label="Тип клиента" value={filters.kind} onChange={(e) => set('kind', e.target.value || null)}>
            <option value="">Физ- и юрлица</option>
            <option value="person">Только физлица</option>
            <option value="legal">Только юрлица</option>
          </Select>
          {view === 'list' && (
            <Select
              aria-label="Этап"
              value={stageId ? String(stageId) : ''}
              onChange={(e) => set('stage', e.target.value || null)}
            >
              <option value="">Все этапы</option>
              {stages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </Select>
          )}
          {view === 'list' && (
            <Select aria-label="Сортировка" value={filters.sort} onChange={(e) => set('sort', e.target.value || null)}>
              <option value="">Сначала новые</option>
              <option value="old">Сначала старые</option>
              <option value="due">По сроку этапа</option>
            </Select>
          )}
          <div className={s.checks}>
            <Checkbox
              label="Просроченные"
              checked={filters.overdue}
              onChange={(e) => set('overdue', e.target.checked ? '1' : null)}
            />
            <Checkbox
              label="Мои"
              checked={params.get('responsible') === String(me.id)}
              onChange={(e) => set('responsible', e.target.checked ? String(me.id) : null)}
            />
            {view === 'list' && (
              <Checkbox
                label="С выданными"
                checked={filters.issued === 'all'}
                onChange={(e) => set('issued', e.target.checked ? 'all' : null)}
              />
            )}
          </div>
        </div>
      </div>

      {orders.isError ? (
        <ErrorBox error={orders.error} />
      ) : !orders.data || !dict.data ? (
        <Spinner />
      ) : view === 'kanban' ? (
        <Kanban stages={stages} orders={orders.data} canAdvance={canAdvance} onAdvance={startAdvance} />
      ) : orders.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox />} title="Заявок не нашли">
            Измените поиск или фильтры. {can('intake.create') && <Link to="/intake">Принять технику</Link>}
          </EmptyState>
        </Card>
      ) : desktop ? (
        <OrdersTable orders={orders.data} stages={stages} />
      ) : (
        <Card className={s.mobileList}>
          {orders.data.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </Card>
      )}

      <AdvanceSheet order={advance?.order ?? null} next={advance?.next ?? null} onClose={() => setAdvance(null)} />
    </>
  );
}
