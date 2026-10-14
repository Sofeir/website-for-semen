import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ClipboardList, Search, UserRound } from 'lucide-react';
import { formatPhone } from '@sd/shared';
import { useClients, useOrders } from '@/api/queries';
import { useDebounced } from '@/lib/hooks';
import { cx } from '@/ui/Button';
import { StagePill } from '@/ui/Display';
import s from './QuickSearch.module.css';

/** Поиск по заявкам и клиентам: номер, имя, телефон, серийный номер. */
export function QuickSearch({ autoFocus, inline, onDone }: { autoFocus?: boolean; inline?: boolean; onDone?: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 200);
  const enabled = dq.length >= 2;
  const orders = useOrders({ q: dq, issued: 'all' }, enabled);
  const clients = useClients({ q: dq, limit: 5 }, enabled);
  const navigate = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = enabled
    ? [
        ...(orders.data ?? []).slice(0, 5).map((o) => ({ key: `o${o.id}`, to: `/orders/${o.id}`, kind: 'order' as const, o })),
        ...(clients.data?.items ?? [])
          .slice(0, 5)
          .map((c) => ({ key: `c${c.id}`, to: `/clients/${c.id}`, kind: 'client' as const, c })),
      ]
    : [];

  useEffect(() => setActive(0), [dq]);

  useEffect(() => {
    if (inline) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [inline]);

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
    setQ('');
    onDone?.();
  };

  const showList = (inline || open) && enabled;

  return (
    <div className={cx(s.wrap, inline && s.inline)} ref={wrap}>
      <div className={s.inputWrap}>
        <Search aria-hidden className={s.icon} />
        <input
          className={s.input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Поиск: номер, клиент, телефон"
          aria-label="Поиск по заявкам и клиентам"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              if (results[active]) go(results[active].to);
              else if (q.trim()) go(`/orders?q=${encodeURIComponent(q.trim())}`);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {showList && (
        <div className={s.list} id={listId} role="listbox">
          {results.length === 0 ? (
            <div className={s.empty}>
              {orders.isFetching || clients.isFetching ? 'Ищем…' : 'Ничего не нашли. Проверьте номер или телефон.'}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.key}
                type="button"
                role="option"
                aria-selected={i === active}
                className={cx(s.item, i === active && s.itemActive)}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.to)}
              >
                {r.kind === 'order' ? (
                  <>
                    <ClipboardList aria-hidden className={s.itemIcon} />
                    <span className={s.itemText}>
                      <span className={s.itemTitle}>
                        №{r.o.number}, {r.o.deviceTitle}
                      </span>
                      <span className={s.itemSub}>{r.o.clientName}</span>
                    </span>
                    <StagePill name={r.o.stageName} color={r.o.stageColor} />
                  </>
                ) : (
                  <>
                    {r.c.kind === 'legal' ? (
                      <Building2 aria-hidden className={s.itemIcon} />
                    ) : (
                      <UserRound aria-hidden className={s.itemIcon} />
                    )}
                    <span className={s.itemText}>
                      <span className={s.itemTitle}>{r.c.name}</span>
                      <span className={s.itemSub}>
                        {formatPhone(r.c.phone) || r.c.contactPerson || (r.c.inn && `ИНН ${r.c.inn}`)}
                      </span>
                    </span>
                  </>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
