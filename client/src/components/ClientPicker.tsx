import { useState } from 'react';
import { Building2, Phone, Search, UserPlus, UserRound, X } from 'lucide-react';
import { formatPhone, type Client, type ClientKind } from '@sd/shared';
import { useClients } from '@/api/queries';
import { useDebounced } from '@/lib/hooks';
import { Button, IconButton } from '@/ui/Button';
import { Input } from '@/ui/Form';
import s from './ClientPicker.module.css';

/**
 * Поиск клиента для формы приёма. Пишут телефон, имя или ИНН —
 * если клиента нет, сразу предлагаем создать с тем, что уже набрано.
 */
export function ClientPicker({
  kind,
  selected,
  onSelect,
  onCreateNew,
  invalid,
}: {
  kind: ClientKind;
  selected: Client | null;
  onSelect: (c: Client | null) => void;
  onCreateNew: (prefill: { name?: string; phone?: string; inn?: string }) => void;
  invalid?: boolean;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const clients = useClients({ q: dq, kind, limit: 8 }, dq.length >= 2);

  if (selected) {
    return (
      <div className={s.selected}>
        <span className={s.icon}>{selected.kind === 'legal' ? <Building2 aria-hidden /> : <UserRound aria-hidden />}</span>
        <div className={s.selMain}>
          <b>{selected.name}</b>
          <span>
            {[formatPhone(selected.phone), selected.contactPerson, selected.inn && `ИНН ${selected.inn}`]
              .filter(Boolean)
              .join(', ')}
          </span>
        </div>
        <IconButton label="Выбрать другого клиента" onClick={() => onSelect(null)}>
          <X />
        </IconButton>
      </div>
    );
  }

  const digits = q.replace(/\D/g, '');
  const looksLikePhone = digits.length >= 5 && digits.length / q.replace(/\s/g, '').length > 0.7;
  const prefill =
    kind === 'legal' && /^\d{10,12}$/.test(digits) && digits.length === q.trim().length
      ? { inn: digits }
      : looksLikePhone
        ? { phone: q.trim() }
        : { name: q.trim() };

  const items = clients.data?.items ?? [];
  return (
    <div className={s.wrap}>
      <Input
        icon={<Search aria-hidden />}
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder={kind === 'legal' ? 'Название, ИНН или телефон' : 'Телефон или имя'}
        aria-label="Найти клиента"
        aria-invalid={invalid}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-autofocus
      />
      {dq.length >= 2 && (
        <div className={s.results}>
          {clients.isFetching && !items.length && <p className={s.hint}>Ищем…</p>}
          {items.map((c) => (
            <button key={c.id} type="button" className={s.item} onClick={() => onSelect(c)}>
              <span className={s.icon}>{c.kind === 'legal' ? <Building2 aria-hidden /> : <UserRound aria-hidden />}</span>
              <span className={s.selMain}>
                <b>{c.name}</b>
                <span>
                  {c.phone && (
                    <>
                      <Phone size={12} aria-hidden /> {formatPhone(c.phone)}
                    </>
                  )}
                  {c.inn && ` ИНН ${c.inn}`}
                  {c.ordersCount ? `, заявок: ${c.ordersCount}` : ''}
                </span>
              </span>
            </button>
          ))}
          {!clients.isFetching && !items.length && <p className={s.hint}>Такого клиента нет в базе.</p>}
        </div>
      )}
      <Button variant="secondary" block icon={<UserPlus size={18} aria-hidden />} onClick={() => onCreateNew(prefill)}>
        {q.trim() ? `Новый клиент: ${q.trim()}` : kind === 'legal' ? 'Новая организация' : 'Новый клиент'}
      </Button>
    </div>
  );
}
