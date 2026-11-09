import { Link } from 'react-router-dom';
import { Clock, FileText, UserRound } from 'lucide-react';
import type { OrderListItem } from '@sd/shared';
import { fmtWhen } from '@/lib/dates';
import { ArrowLink, cx } from '@/ui/Button';
import { NumberTag, StagePill } from '@/ui/Display';
import s from './rows.module.css';

export interface RowSelect {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function OrderRow({ order, showStage = true, select }: { order: OrderListItem; showStage?: boolean; select?: RowSelect }) {
  const late = order.overdue;
  return (
    <div className={s.row}>
      {select && (
        <label className={s.pick}>
          <input
            type="checkbox"
            checked={select.checked}
            onChange={(e) => select.onChange(e.target.checked)}
            aria-label={`Выбрать заявку ${order.number}`}
          />
        </label>
      )}
      <Link to={`/orders/${order.id}`} className={s.rowLink}>
        <NumberTag>{order.number}</NumberTag>
        <span className={s.main}>
          <span className={s.title}>{order.deviceTitle}</span>
          <span className={s.sub}>
            {order.clientName}, {order.fault}
          </span>
          <span className={s.meta}>
            {showStage && <StagePill name={order.stageName} color={order.stageColor} />}
            {order.responsibleName && (
              <span className={s.metaItem}>
                <UserRound aria-hidden />
                {order.responsibleName}
              </span>
            )}
            {order.actsCount > 0 && (
              <span className={s.metaItem}>
                <FileText aria-hidden />
                акт
              </span>
            )}
            {order.stageDueAt && !order.issuedAt && (
              <span className={cx(s.metaItem, late && s.late)}>
                <Clock aria-hidden />
                {late ? 'просрочено: ' : 'до '}
                {fmtWhen(order.stageDueAt)}
              </span>
            )}
          </span>
        </span>
      </Link>
      <span className={cx(s.side, s.hideSm)}>
        <ArrowLink to={`/orders/${order.id}`} label={`Открыть заявку ${order.number}`} light />
      </span>
    </div>
  );
}
