import { Wrench } from 'lucide-react';
import { useCustomerOrders } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { fmtDate } from '@/lib/dates';
import { Card, EmptyState, ErrorBox, PageHeader, Pill, Spinner } from '@/ui/Display';
import s from './Customer.module.css';

export default function CustomerOrdersPage() {
  useDocumentTitle('Моя техника');
  const orders = useCustomerOrders();
  const list = orders.data ?? [];

  return (
    <>
      <PageHeader title="Моя техника" subtitle="Что сейчас у нас в ремонте и на каком этапе." />
      {orders.isError ? (
        <ErrorBox error={orders.error} />
      ) : !orders.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState icon={<Wrench />} title="Техники в ремонте нет">
          Когда вы сдадите технику в сервис, она появится здесь вместе с этапом работы.
        </EmptyState>
      ) : (
        <Card>
          <div>
            {list.map((o) => (
              <article key={o.id} className={s.device}>
                <div className={s.deviceHead}>
                  <h2 className={s.deviceTitle}>
                    <span className={s.deviceNum}>№{o.number}</span>
                    {o.deviceTitle}
                  </h2>
                  <Pill tone={o.stageColor} dot>
                    {o.stageName}
                  </Pill>
                </div>
                <div className={s.meta}>
                  <span>Принята {fmtDate(o.createdAt)}</span>
                  {o.issuedAt && <span>Выдана {fmtDate(o.issuedAt)}</span>}
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
