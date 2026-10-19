import { useEffect, useState } from 'react';
import { Building2, ChevronRight, Search, UserRound } from 'lucide-react';
import { formatPhone } from '@sd/shared';
import { useClients } from '@/api/queries';
import { useDebounced } from '@/lib/hooks';
import { EmptyState, Spinner } from '@/ui/Display';
import { Input } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import s from './ClientPickSheet.module.css';

export interface PickedClient {
  id: number;
  name: string;
}

/** Выбор клиента поиском по имени, телефону или ИНН — например, чтобы назначить ему выезд. */
export function ClientPickSheet({
  open,
  onClose,
  onPick,
  title = 'Выберите клиента',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (c: PickedClient) => void;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const clients = useClients({ q: dq, limit: 30 });
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const items = clients.data?.items ?? [];

  return (
    <Sheet open={open} onClose={onClose} title={title} width={520}>
      <Input
        icon={<Search aria-hidden />}
        type="search"
        placeholder="Имя, телефон, ИНН"
        aria-label="Поиск клиента"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={s.search}
        data-autofocus
      />
      {!clients.data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon={<Search />} title="Никого не нашли">
          Проверьте написание или поищите по телефону.
        </EmptyState>
      ) : (
        <ul className={s.list}>
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className={s.row} onClick={() => onPick({ id: c.id, name: c.name })}>
                <span className={s.icon}>{c.kind === 'legal' ? <Building2 aria-hidden /> : <UserRound aria-hidden />}</span>
                <span className={s.main}>
                  <b>{c.name}</b>
                  {c.phone && <span>{formatPhone(c.phone)}</span>}
                </span>
                <ChevronRight aria-hidden className={s.chev} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
