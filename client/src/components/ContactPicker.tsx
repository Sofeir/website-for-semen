import { useEffect, useState } from 'react';
import { Phone, Search, UserPlus, UserRound, X } from 'lucide-react';
import { formatPhone, type Client, type Contact } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useClients, useContacts, useInvalidate } from '@/api/queries';
import { useDebounced } from '@/lib/hooks';
import { Button, IconButton } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './ClientPicker.module.css';

/** Подпись человека в списках: должность и телефон, если есть. */
export const contactLine = (c: Pick<Contact, 'position' | 'phone'>) =>
  [c.position, c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(', ');

/**
 * Кто подал заявку: человек из организации. Пишут первые буквы ФИО или телефон, система подсказывает людей,
 * которые уже есть в базе. Если человека нет, его добавляют прямо здесь (ФИО и телефон обязательны, должность нет).
 * Частного клиента с таким же именем можно добавить в организацию одним нажатием, заново вводить его не нужно.
 */
export function ContactPicker({
  clientId,
  value,
  onChange,
}: {
  clientId: number;
  value: Contact | null;
  onChange: (c: Contact | null) => void;
}) {
  const inv = useInvalidate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q.trim(), 200);
  const people = useContacts(clientId, dq);
  const persons = useClients({ q: dq, kind: 'person', limit: 4 }, dq.length >= 2);

  useEffect(() => {
    setQ('');
  }, [clientId]);

  const pickPerson = async (p: Client) => {
    try {
      const r = await api.post<{ id: number }>(`/clients/${clientId}/contacts/from-person`, { personClientId: p.id });
      const list = await api.get<Contact[]>(`/clients/${clientId}/contacts`);
      const found = list.find((c) => c.id === r.id);
      inv('contacts');
      if (found) onChange(found);
    } catch (e) {
      toast.error('Не получилось добавить', (e as ApiError).message);
    }
  };

  if (value) {
    return (
      <div className={s.selected}>
        <span className={s.icon}>
          <UserRound aria-hidden />
        </span>
        <div className={s.selMain}>
          <b>{value.fullName}</b>
          <span>{contactLine(value) || 'Телефон не указан'}</span>
        </div>
        <IconButton label="Выбрать другого сотрудника" onClick={() => onChange(null)}>
          <X />
        </IconButton>
      </div>
    );
  }

  const items = people.data ?? [];
  const personItems = (persons.data?.items ?? []).filter((p) => !items.some((c) => c.personClientId === p.id));
  return (
    <div className={s.wrap}>
      <Input
        icon={<Search aria-hidden />}
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder="Первые буквы ФИО или телефон"
        aria-label="Найти сотрудника организации"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {(items.length > 0 || personItems.length > 0 || dq.length >= 2) && (
        <div className={s.results}>
          {items.slice(0, 6).map((c) => (
            <button key={c.id} type="button" className={s.item} onClick={() => onChange(c)}>
              <span className={s.icon}>
                <UserRound aria-hidden />
              </span>
              <span className={s.selMain}>
                <b>{c.fullName}</b>
                <span>
                  {c.phone && <Phone size={12} aria-hidden />} {contactLine(c) || 'Телефон не указан'}
                </span>
              </span>
            </button>
          ))}
          {personItems.map((p) => (
            <button key={`p${p.id}`} type="button" className={s.item} onClick={() => pickPerson(p)}>
              <span className={s.icon}>
                <UserPlus aria-hidden />
              </span>
              <span className={s.selMain}>
                <b>{p.name}</b>
                <span>Частный клиент, добавить в организацию{p.phone ? `, ${formatPhone(p.phone)}` : ''}</span>
              </span>
            </button>
          ))}
          {dq.length >= 2 && !people.isFetching && !items.length && !personItems.length && (
            <p className={s.hint}>Такого человека нет в базе организации.</p>
          )}
        </div>
      )}
      <Button variant="secondary" block icon={<UserPlus size={18} aria-hidden />} onClick={() => setAdding(true)}>
        {q.trim() ? `Добавить клиента: ${q.trim()}` : 'Добавить клиента'}
      </Button>
      <ContactFormSheet
        open={adding}
        clientId={clientId}
        prefill={q.trim()}
        onClose={() => setAdding(false)}
        onSaved={(c) => {
          setAdding(false);
          onChange(c);
        }}
      />
    </div>
  );
}

/** Новый человек организации: ФИО и телефон обязательны, должность можно не писать. */
export function ContactFormSheet({
  open,
  clientId,
  prefill,
  contact,
  onClose,
  onSaved,
}: {
  open: boolean;
  clientId: number;
  prefill?: string;
  /** Если передан, форма правит этого человека. */
  contact?: Contact | null;
  onClose: () => void;
  onSaved: (c: Contact) => void;
}) {
  const inv = useInvalidate();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const digits = (prefill ?? '').replace(/\D/g, '');
    const isPhone = !contact && digits.length >= 5 && digits.length / (prefill ?? '').replace(/\s/g, '').length > 0.7;
    setFullName(contact?.fullName ?? (isPhone ? '' : (prefill ?? '')));
    setPhone(contact?.phone ?? (isPhone ? (prefill ?? '') : ''));
    setPosition(contact?.position ?? '');
    setError('');
  }, [open, prefill, contact]);

  const save = async () => {
    setError('');
    if (fullName.trim().length < 2) return setError('Укажите ФИО');
    if (phone.replace(/\D/g, '').length < 5) return setError('Укажите телефон');
    setBusy(true);
    try {
      const body = { fullName: fullName.trim(), phone: phone.trim(), position: position.trim() || null };
      let id: number;
      if (contact) {
        await api.put(`/contacts/${contact.id}`, body);
        id = contact.id;
      } else {
        id = (await api.post<{ id: number }>(`/clients/${clientId}/contacts`, body)).id;
      }
      const list = await api.get<Contact[]>(`/clients/${clientId}/contacts`);
      inv('contacts', 'order', 'orders', 'client');
      const saved = list.find((c) => c.id === id);
      if (saved) onSaved(saved);
    } catch (e) {
      const err = e as ApiError;
      if (err.data?.code === 'contact_exists' && err.data.contactId) {
        const list = await api.get<Contact[]>(`/clients/${clientId}/contacts`);
        const existing = list.find((c) => c.id === err.data.contactId);
        if (existing) return onSaved(existing);
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={contact ? 'Правка сотрудника' : 'Добавить клиента'}
      subtitle="Человек из организации, который сдаёт технику"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} loading={busy}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className={formStyles.grid2}>
          <Field label="ФИО" className={formStyles.span2}>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" data-autofocus maxLength={120} />
          </Field>
          <Field label="Телефон">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="+7 900 000-00-00"
              maxLength={32}
            />
          </Field>
          <Field label="Должность" optional>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} autoComplete="off" placeholder="Например: бухгалтер" maxLength={120} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
