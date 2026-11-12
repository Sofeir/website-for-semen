import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, Spinner } from '@/ui/Display';
import { Checkbox } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import s from './Settings.module.css';

interface Stuck {
  id: number;
  number: string;
  clientName: string;
  deviceTitle: string;
  stageName: string;
  responsibleName: string | null;
  closedAt: string;
  closeComment: string | null;
  nextStageName: string | null;
  problem: string | null;
}

/**
 * Заявки, у которых задачу этапа закрыли, а сама заявка осталась на этапе (так было до автоперехода).
 * Диагностику и ремонт можно подвинуть сразу, согласование и выдачу двигает человек.
 */
export function StuckOrders() {
  const inv = useInvalidate();
  const toast = useToast();
  const q = useQuery({ queryKey: ['stuckOrders'], queryFn: () => api.get<Stuck[]>('/orders/stuck') });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const movable = (q.data ?? []).filter((r) => !r.problem);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async (ids: number[]) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ advanced: number[]; blocked: { id: number; message: string }[] }>('/orders/stuck/advance', { ids });
      inv('orders', 'order', 'tasks', 'dashboard');
      await q.refetch();
      setPicked(new Set());
      if (r.advanced.length) toast.success(`Сдвинуто заявок: ${r.advanced.length}`);
      if (r.blocked.length) toast.error(`Не сдвинуто: ${r.blocked.length}`, r.blocked[0]!.message);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="stack">
        <div>
          <h3 className={s.dictTitle}>Застрявшие заявки</h3>
          <p className={s.dictHint}>
            Задачу этапа закрыли, а заявка осталась на этом же этапе. Диагностику и ремонт можно сдвинуть сразу: ответственным станет тот, кто закрыл задачу,
            а его комментарий попадёт в историю. Согласование и выдачу двигает человек в самой заявке.
          </p>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <EmptyState icon={<CheckCircle2 />} title="Застрявших заявок нет" />
        ) : (
          <>
            <div className="row wrap">
              <Button
                icon={<ArrowRight size={18} aria-hidden />}
                loading={busy}
                disabled={!picked.size}
                onClick={() => run([...picked])}
              >
                Сдвинуть выбранные ({picked.size})
              </Button>
              <Button variant="secondary" disabled={!movable.length || busy} onClick={() => setPicked(new Set(movable.map((r) => r.id)))}>
                Выбрать все, что можно ({movable.length})
              </Button>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
              {q.data.map((r) => (
                <li key={r.id} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <Checkbox label="" aria-label={`Заявка №${r.number}`} checked={picked.has(r.id)} disabled={Boolean(r.problem)} onChange={() => toggle(r.id)} />
                  <div style={{ minWidth: 0 }}>
                    <b>
                      <Link to={`/orders/${r.id}`}>№{r.number}</Link>, {r.deviceTitle}
                    </b>
                    <div className="muted">
                      {r.clientName}. Этап «{r.stageName}», задачу закрыл(а) {fmtWhen(r.closedAt)}
                      {r.closeComment ? `: ${r.closeComment}` : ''}
                    </div>
                    <div>{r.problem ? <span className="muted">{r.problem}</span> : <span>Перейдёт на «{r.nextStageName}», ответственный {r.responsibleName ?? '—'}</span>}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
