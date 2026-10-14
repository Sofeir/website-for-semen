import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronsRight, Clock, UserRound } from 'lucide-react';
import type { OrderListItem, Stage } from '@sd/shared';
import { fmtWhen } from '@/lib/dates';
import { cx } from '@/ui/Button';
import { NumberTag, Pill } from '@/ui/Display';
import { useToast } from '@/ui/Toast';
import s from './Orders.module.css';

interface Props {
  stages: Stage[];
  orders: OrderListItem[];
  canAdvance: (o: OrderListItem) => boolean;
  onAdvance: (o: OrderListItem) => void;
}

/**
 * Канбан этапов. Колонки — все этапы, кроме «Приёма» (заявка проходит его в момент сохранения формы).
 * Перетаскивать можно только в следующую колонку; на телефоне — свайп по колонкам и кнопка «дальше».
 */
export function Kanban({ stages, orders, canAdvance, onAdvance }: Props) {
  const toast = useToast();
  const columns = stages.slice(1);
  const byStage = useMemo(() => {
    const map = new Map<number, OrderListItem[]>();
    for (const st of columns) map.set(st.id, []);
    for (const o of orders) map.get(o.stageId)?.push(o);
    return map;
  }, [orders, columns]);
  const [dragging, setDragging] = useState<OrderListItem | null>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));
  const board = useRef<HTMLDivElement>(null);

  const nextOf = (o: OrderListItem) => {
    const idx = stages.findIndex((st) => st.id === o.stageId);
    return stages[idx + 1] ?? null;
  };

  const onDragEnd = (e: DragEndEvent) => {
    const order = dragging;
    setDragging(null);
    if (!order || !e.over) return;
    const target = Number(e.over.id);
    if (target === order.stageId) return;
    const next = nextOf(order);
    if (!next || next.id !== target) {
      toast.error('Этапы идут строго по порядку', next ? `Следующий этап для этой заявки — «${next.name}».` : undefined);
      return;
    }
    if (!canAdvance(order)) {
      toast.error('Нет прав', 'Перевести заявку может ответственный или руководитель.');
      return;
    }
    onAdvance(order);
  };

  const jump = (stageId: number) => {
    board.current
      ?.querySelector(`[data-stage="${stageId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  const allowedTarget = dragging ? nextOf(dragging)?.id : null;

  return (
    <>
      <nav className={s.stageJump} aria-label="Перейти к этапу">
        {columns.map((st) => (
          <button key={st.id} type="button" onClick={() => jump(st.id)} className={s.stageJumpBtn}>
            <span className={cx(s.stageDot, s[`dot_${st.color}`])} aria-hidden />
            {st.name}
            <span className={s.stageJumpCount}>{byStage.get(st.id)?.length ?? 0}</span>
          </button>
        ))}
      </nav>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging(orders.find((o) => o.id === Number(e.active.id)) ?? null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className={s.board} ref={board}>
          {columns.map((st) => (
            <Column
              key={st.id}
              stage={st}
              number={String(stages.indexOf(st) + 1).padStart(2, '0')}
              orders={byStage.get(st.id) ?? []}
              state={!dragging ? 'idle' : allowedTarget === st.id ? 'allowed' : dragging.stageId === st.id ? 'source' : 'blocked'}
            >
              <AnimatePresence initial={false}>
                {(byStage.get(st.id) ?? []).map((o) => {
                  const next = nextOf(o);
                  return (
                    <KanbanCard
                      key={o.id}
                      order={o}
                      next={next}
                      canAdvance={canAdvance(o) && Boolean(next)}
                      onAdvance={() => onAdvance(o)}
                      dimmed={dragging?.id === o.id}
                    />
                  );
                })}
              </AnimatePresence>
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <CardBody order={dragging} lifted />}</DragOverlay>
      </DndContext>
    </>
  );
}

function Column({
  stage,
  number,
  orders,
  state,
  children,
}: {
  stage: Stage;
  number: string;
  orders: OrderListItem[];
  state: 'idle' | 'allowed' | 'source' | 'blocked';
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const overdue = orders.filter((o) => o.overdue).length;
  return (
    <section
      ref={setNodeRef}
      className={cx(s.column, s[`col_${state}`], isOver && state === 'allowed' && s.colOver)}
      data-stage={stage.id}
      aria-label={`${stage.name}, ${orders.length}`}
    >
      <header className={s.colHead}>
        <span className={s.colNum}>{number}</span>
        <h2 className={s.colTitle}>{stage.isFinal ? 'Выдано' : stage.name}</h2>
        <span className={s.colCount}>{orders.length}</span>
        {overdue > 0 && (
          <Pill tone="red" title="Просрочено">
            {overdue}
          </Pill>
        )}
      </header>
      {stage.isFinal && <p className={s.colHint}>за последние 14 дней</p>}
      <div className={s.colBody}>
        {children}
        {orders.length === 0 && <p className={s.colEmpty}>{state === 'allowed' ? 'Отпустите здесь' : 'Пусто'}</p>}
      </div>
    </section>
  );
}

function KanbanCard({
  order,
  next,
  canAdvance,
  onAdvance,
  dimmed,
}: {
  order: OrderListItem;
  next: Stage | null;
  canAdvance: boolean;
  onAdvance: () => void;
  dimmed: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: order.id, disabled: !canAdvance });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.35 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      ref={setNodeRef}
      className={s.cardWrap}
      {...listeners}
      {...attributes}
      role="listitem"
      tabIndex={-1}
    >
      <CardBody order={order} />
      {canAdvance && next && (
        <button
          type="button"
          className={s.advanceBtn}
          onClick={onAdvance}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Перевести №${order.number} на этап «${next.name}»`}
          title={`Дальше: ${next.name}`}
        >
          <ChevronsRight aria-hidden />
          <span>{next.isFinal ? 'Выдать' : next.name}</span>
        </button>
      )}
    </motion.div>
  );
}

function CardBody({ order, lifted }: { order: OrderListItem; lifted?: boolean }) {
  return (
    <div className={cx(s.card, lifted && s.cardLifted)}>
      <Link to={`/orders/${order.id}`} className={s.cardLink} onPointerDown={(e) => e.stopPropagation()} draggable={false}>
        <div className={s.cardTop}>
          <NumberTag>{order.number}</NumberTag>
          {order.clientKind === 'legal' && <Pill tone="outline">юрлицо</Pill>}
        </div>
        <div className={s.cardTitle}>{order.deviceTitle}</div>
        <div className={s.cardFault}>{order.fault}</div>
        <div className={s.cardClient}>{order.clientName}</div>
      </Link>
      <div className={s.cardMeta}>
        {order.responsibleName && (
          <span className={s.cardMetaItem}>
            <UserRound aria-hidden />
            {order.responsibleName}
          </span>
        )}
        {(order.stageDueAt || order.issuedAt) && (
          <span className={cx(s.cardMetaItem, order.overdue && s.late)}>
            <Clock aria-hidden />
            {order.issuedAt ? `выдано ${fmtWhen(order.issuedAt, false)}` : fmtWhen(order.stageDueAt)}
          </span>
        )}
      </div>
    </div>
  );
}
