import { useState } from 'react';
import { MapPin, Clock, Mail, Phone } from 'lucide-react';
import { useCustomerOrders, useCustomerCompany, useCustomerTasks } from '@/api/queries';
import { useMe } from '@/app/auth';
import { useDocumentTitle } from '@/lib/hooks';
import { Button } from '@/ui/Button';
import { Card, CardHead, Plate, Skeleton } from '@/ui/Display';
import { NewTaskSheet, TasksPanel } from './CustomerTasksPage';
import { OrdersPanel } from './CustomerOrdersPage';
import s from './Customer.module.css';

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** Главная заказчика: приветствие со сводкой, свои задачи, своя техника и контакты сервиса. */
export default function CustomerHome() {
  useDocumentTitle('Кабинет заказчика');
  const me = useMe();
  const tasks = useCustomerTasks();
  const orders = useCustomerOrders();
  const company = useCustomerCompany();
  const [creating, setCreating] = useState(false);

  const t = tasks.data;
  const o = orders.data;
  const stats = [
    { label: 'Задач в работе', value: t ? t.filter((x) => x.status === 'open').length : null },
    { label: 'Задач выполнено', value: t ? t.filter((x) => x.status === 'done').length : null, ok: true },
    { label: 'Техники в ремонте', value: o ? o.filter((x) => !x.isFinal).length : null },
  ];
  const c = company.data;

  return (
    <>
      <Plate className={s.hero}>
        <div className={s.heroTop}>
          <div>
            <p className={s.greeting}>
              {greeting()}, {me.fullName.split(' ')[0]}
            </p>
            <p className={s.heroText}>Ставьте задачи сервис-центру и следите, как они движутся, а также как идёт ремонт вашей техники.</p>
          </div>
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Поставить задачу
          </Button>
        </div>
        <div className={s.stats}>
          {stats.map((st) => (
            <div key={st.label} className={s.stat}>
              {st.value === null ? (
                <Skeleton h={40} w={60} />
              ) : (
                <span className={`${s.statValue} ${st.ok && st.value ? s.statOk : ''}`}>{st.value}</span>
              )}
              <span className={s.statLabel}>{st.label}</span>
            </div>
          ))}
        </div>
      </Plate>

      <div className={s.grid}>
        <div className={s.col}>
          <TasksPanel onCreate={() => setCreating(true)} />
        </div>
        <div className={s.col}>
          <OrdersPanel />
          {c && (c.phone || c.address || c.email || c.workHours) && (
            <Card>
              <CardHead title="Как с нами связаться" />
              <ul className={s.contacts}>
                {c.phone && (
                  <li>
                    <Phone aria-hidden />
                    <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>
                  </li>
                )}
                {c.email && (
                  <li>
                    <Mail aria-hidden />
                    <a href={`mailto:${c.email}`}>{c.email}</a>
                  </li>
                )}
                {c.address && (
                  <li>
                    <MapPin aria-hidden />
                    {c.address}
                  </li>
                )}
                {c.workHours && (
                  <li>
                    <Clock aria-hidden />
                    {c.workHours}
                  </li>
                )}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
