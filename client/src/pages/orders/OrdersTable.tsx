import { useNavigate } from 'react-router-dom';
import type { OrderListItem, Stage } from '@sd/shared';
import { formatPhone } from '@sd/shared';
import { fmtWhen } from '@/lib/dates';
import { ArrowLink, cx } from '@/ui/Button';
import { NumberTag, StagePill } from '@/ui/Display';
import s from './Orders.module.css';

/** Таблица заявок для широкого экрана. На телефоне вместо неё карточки. */
export function OrdersTable({ orders }: { orders: OrderListItem[]; stages: Stage[] }) {
  const navigate = useNavigate();
  return (
    <div className={s.tableCard}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Номер</th>
            <th scope="col">Техника и неисправность</th>
            <th scope="col">Клиент</th>
            <th scope="col">Этап и ответственный</th>
            <th scope="col">Срок этапа</th>
            <th scope="col">
              <span className="visually-hidden">Открыть</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className={s.tr}>
              <td>
                <NumberTag>{o.number}</NumberTag>
              </td>
              <td className={s.tdMain}>
                <b>{o.deviceTitle}</b>
                <span>{o.fault}</span>
              </td>
              <td className={s.tdMain}>
                <b className={s.normal}>{o.clientName}</b>
                <span>{formatPhone(o.clientPhone)}</span>
              </td>
              <td>
                <StagePill name={o.stageName} color={o.stageColor} />
                <span className={s.who}>{o.responsibleName ?? '—'}</span>
              </td>
              <td className={cx('num', o.overdue && s.late)}>
                {o.issuedAt ? `выдано ${fmtWhen(o.issuedAt, false)}` : fmtWhen(o.stageDueAt)}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <ArrowLink to={`/orders/${o.id}`} label={`Открыть заявку ${o.number}`} light />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
