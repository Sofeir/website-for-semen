import { useEffect, useState } from 'react';
import { Check, PackageCheck, ShoppingCart, Truck, X } from 'lucide-react';
import { PURCHASE_STATUS_LABELS, type PurchaseEvent, type PurchaseStatus } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate, useMarkSeen, usePurchase } from '@/api/queries';
import { UserSelect } from '@/components/Pickers';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ErrorBox, Spinner } from '@/ui/Display';
import { Field, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './Purchases.module.css';

const CHAIN: PurchaseStatus[] = ['approval', 'buying', 'delivery', 'done'];

const EVENT_TEXT: Record<PurchaseEvent['action'], string> = {
  created: 'Отправлено на согласование',
  approved: 'Согласовано',
  rejected: 'Отказано',
  bought: 'Куплено',
  delivered: 'Отвезено',
  cancelled: 'Закупка отменена',
};

type Step = 'approve' | 'reject' | 'bought' | 'delivered' | 'cancel';

const DONE_TEXT: Record<Step, string> = {
  approve: 'Закупка согласована',
  reject: 'Закупка отклонена',
  bought: 'Отмечено: куплено',
  delivered: 'Отмечено: отвезено',
  cancel: 'Закупка отменена',
};

/** Окно закупки: на каком она шаге, кто что сделал и кнопка следующего шага. */
export function PurchaseSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = usePurchase(id);
  const inv = useInvalidate();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [buyerId, setBuyerId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Step | null>(null);
  const p = q.data;
  useMarkSeen(id ? `/purchases?open=${id}` : null);

  useEffect(() => {
    setComment('');
    setError('');
    setBuyerId('');
  }, [id]);

  const run = async (step: Step) => {
    if (!p) return;
    setError('');
    setBusy(step);
    try {
      await api.post(`/purchases/${p.id}/${step}`, {
        comment: comment.trim(),
        buyerId: step === 'approve' && buyerId && Number(buyerId) !== p.buyerId ? Number(buyerId) : null,
      });
      await inv('purchases', 'purchase', 'notifications');
      toast.success(DONE_TEXT[step]);
      setComment('');
      setBuyerId('');
      if (step === 'reject' || step === 'cancel' || step === 'delivered') onClose();
    } catch (e) {
      setError((e as ApiError).message);
      void inv('purchases', 'purchase');
    } finally {
      setBusy(null);
    }
  };

  const idx = p ? CHAIN.indexOf(p.status) : -1;
  const bad = p?.status === 'rejected' || p?.status === 'cancelled';
  const hasActions = Boolean(p && (p.canApprove || p.canAdvance || p.canCancel));

  return (
    <Sheet
      open={id !== null}
      onClose={onClose}
      title={p?.title ?? 'Закупка'}
      subtitle={p ? PURCHASE_STATUS_LABELS[p.status] : undefined}
      width={520}
    >
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox error={q.error} />}
      {p && (
        <>
          <ol className={s.chain} aria-label="Шаги закупки">
            {CHAIN.map((st, i) => (
              <li
                key={st}
                className={bad ? s.step : i < idx || p.status === 'done' ? `${s.step} ${s.stepDone}` : i === idx ? `${s.step} ${s.stepNow}` : s.step}
              >
                {PURCHASE_STATUS_LABELS[st]}
              </li>
            ))}
          </ol>
          {bad && <p className={s.stepBad} style={{ padding: 'var(--s-2) var(--s-3)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--s-4)' }}>{PURCHASE_STATUS_LABELS[p.status]}</p>}

          <dl className={s.facts}>
            <dt>Для кого</dt>
            <dd>{p.clientName ?? 'Не указано'}</dd>
            <dt>Завёл</dt>
            <dd>{p.creatorName}</dd>
            <dt>Покупает</dt>
            <dd>{p.buyerName}</dd>
            {p.comment && (
              <>
                <dt>Комментарий</dt>
                <dd>{p.comment}</dd>
              </>
            )}
          </dl>

          <h3 className={s.sectionTitle}>История</h3>
          <ul className={s.history}>
            {p.events.map((e) => (
              <li key={e.id}>
                <b>{EVENT_TEXT[e.action]}</b>, {e.actorName}
                {e.comment && <>: {e.comment}</>}
                <br />
                <time>{fmtWhen(e.createdAt)}</time>
              </li>
            ))}
          </ul>

          {hasActions && (
            <div className="stack">
              {error && <ErrorBox>{error}</ErrorBox>}
              {p.canApprove && (
                <Field label="Кто покупает" optional hint="По умолчанию покупает тот, кто завёл заявку">
                  <UserSelect value={buyerId || String(p.buyerId)} onChange={(e) => setBuyerId(e.target.value)} />
                </Field>
              )}
              <Field label="Комментарий" optional>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} />
              </Field>
              <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--s-2)' }}>
                {p.canApprove && (
                  <>
                    <Button loading={busy === 'approve'} disabled={busy !== null} icon={<Check size={18} aria-hidden />} onClick={() => run('approve')}>
                      Согласовать
                    </Button>
                    <Button variant="secondary" loading={busy === 'reject'} disabled={busy !== null} onClick={() => run('reject')}>
                      Отказать
                    </Button>
                  </>
                )}
                {p.canAdvance && p.status === 'buying' && (
                  <Button loading={busy === 'bought'} disabled={busy !== null} icon={<ShoppingCart size={18} aria-hidden />} onClick={() => run('bought')}>
                    Куплено
                  </Button>
                )}
                {p.canAdvance && p.status === 'delivery' && (
                  <Button loading={busy === 'delivered'} disabled={busy !== null} icon={<Truck size={18} aria-hidden />} onClick={() => run('delivered')}>
                    Отвёз
                  </Button>
                )}
                {p.canCancel && (
                  <Button variant="ghost" loading={busy === 'cancel'} disabled={busy !== null} icon={<X size={18} aria-hidden />} onClick={() => run('cancel')}>
                    Отменить закупку
                  </Button>
                )}
              </div>
            </div>
          )}
          {!hasActions && p.status === 'done' && (
            <p className={s.hint} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
              <PackageCheck size={18} aria-hidden /> Закупка закрыта
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
