import { Link } from 'react-router-dom';
import { Building2, Check, Mail, Phone, UserRound, UserCheck, X } from 'lucide-react';
import { formatPhone, type CustomerAccount } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useCustomers, useInvalidate } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { useConfirm } from '@/ui/Confirm';
import { Card, CardHead, EmptyState, ErrorBox, PageHeader, Pill, Spinner } from '@/ui/Display';
import { useToast } from '@/ui/Toast';
import s from './Customers.module.css';

export default function CustomersPage() {
  useDocumentTitle('Заказчики');
  const q = useCustomers();
  const list = q.data ?? [];
  const pending = list.filter((c) => c.pending);
  const active = list.filter((c) => !c.pending);

  return (
    <>
      <PageHeader
        title="Заказчики"
        subtitle="Клиенты, которые сами ставят задачи через свой кабинет. Доступ открываете вы."
      />
      {q.isError ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Spinner />
      ) : (
        <div className={s.sections}>
          <Card>
            <CardHead title="Ждут подтверждения" count={pending.length} />
            {pending.length === 0 ? (
              <p className="muted">Новых регистраций нет.</p>
            ) : (
              <div className={s.list}>
                {pending.map((c) => (
                  <PendingRow key={c.id} c={c} />
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHead title="Кабинеты заказчиков" count={active.length} />
            {active.length === 0 ? (
              <EmptyState icon={<UserCheck />} title="Пока нет заказчиков">
                Когда клиент зарегистрируется и вы подтвердите доступ, он появится здесь.
              </EmptyState>
            ) : (
              <div className={s.list}>
                {active.map((c) => (
                  <ActiveRow key={c.id} c={c} />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Who({ c }: { c: CustomerAccount }) {
  const Icon = c.kind === 'legal' ? Building2 : UserRound;
  return (
    <div className={s.who}>
      <span className={s.avatar}>
        <Icon aria-hidden />
      </span>
      <div className={s.whoText}>
        <b>{c.fullName}</b>
        <span className={s.contacts}>
          {c.phone && (
            <span>
              <Phone aria-hidden />
              {formatPhone(c.phone)}
            </span>
          )}
          {c.email && (
            <span>
              <Mail aria-hidden />
              {c.email}
            </span>
          )}
          <span>логин {c.login}</span>
        </span>
      </div>
    </div>
  );
}

function PendingRow({ c }: { c: CustomerAccount }) {
  const toast = useToast();
  const inv = useInvalidate();
  const confirm = useConfirm();
  return (
    <article className={s.row}>
      <Who c={c} />
      <div className={s.meta}>
        <Pill tone="amber" dot>
          Ждёт подтверждения
        </Pill>
        <span>Зарегистрировался {fmtWhen(c.createdAt)}</span>
      </div>
      <div className={s.actions}>
        <Button
          icon={<Check size={18} aria-hidden />}
          onClick={async () => {
            try {
              await api.post(`/customers/${c.id}/approve`);
              await inv('customers', 'clients');
              toast.success('Доступ открыт', 'Кабинет привязан к карточке клиента. Заказчик может входить.');
            } catch (e) {
              toast.error('Не получилось подтвердить', e instanceof ApiError ? e.message : undefined);
            }
          }}
        >
          Подтвердить
        </Button>
        <Button
          variant="secondary"
          icon={<X size={18} aria-hidden />}
          onClick={async () => {
            const ok = await confirm({
              title: 'Отклонить регистрацию?',
              body: `${c.fullName}. Заявка будет удалена, логин «${c.login}» освободится.`,
              confirm: 'Отклонить',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.post(`/customers/${c.id}/reject`);
              await inv('customers');
              toast.success('Регистрация отклонена');
            } catch (e) {
              toast.error('Не получилось отклонить', e instanceof ApiError ? e.message : undefined);
            }
          }}
        >
          Отклонить
        </Button>
      </div>
    </article>
  );
}

function ActiveRow({ c }: { c: CustomerAccount }) {
  const toast = useToast();
  const inv = useInvalidate();
  return (
    <article className={s.row}>
      <Who c={c} />
      <div className={s.meta}>
        <Pill tone={c.isActive ? 'teal' : 'slate'} dot>
          {c.isActive ? 'Доступ открыт' : 'Доступ закрыт'}
        </Pill>
        {c.clientId && (
          <Link to={`/clients/${c.clientId}`} className={s.link}>
            Карточка клиента
          </Link>
        )}
        <span>Задач: {c.tasksCount}</span>
      </div>
      <div className={s.actions}>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await api.put(`/customers/${c.id}`, { isActive: !c.isActive });
              await inv('customers');
              toast.success(c.isActive ? 'Доступ закрыт' : 'Доступ открыт');
            } catch (e) {
              toast.error('Не получилось изменить доступ', e instanceof ApiError ? e.message : undefined);
            }
          }}
        >
          {c.isActive ? 'Закрыть доступ' : 'Открыть доступ'}
        </Button>
      </div>
    </article>
  );
}
