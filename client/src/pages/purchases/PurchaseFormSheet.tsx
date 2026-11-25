import { useEffect, useState } from 'react';
import { Building2, Search, UserRound, X } from 'lucide-react';
import type { PurchaseClientHit } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate, usePurchaseClients } from '@/api/queries';
import { useDebounced } from '@/lib/hooks';
import { Button, IconButton } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Textarea } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import s from './Purchases.module.css';

/** Поле «Для кого»: набираете буквы, ниже подходящие клиенты. Можно не заполнять. */
function ForWhom({ value, onChange }: { value: PurchaseClientHit | null; onChange: (c: PurchaseClientHit | null) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const hits = usePurchaseClients(dq);
  if (value) {
    return (
      <div className={s.picked}>
        {value.kind === 'legal' ? <Building2 size={18} aria-hidden /> : <UserRound size={18} aria-hidden />}
        <b>{value.name}</b>
        <IconButton label="Выбрать другого" onClick={() => onChange(null)}>
          <X />
        </IconButton>
      </div>
    );
  }
  const items = hits.data ?? [];
  return (
    <>
      <Input
        icon={<Search aria-hidden />}
        type="search"
        autoComplete="off"
        placeholder="Начните вводить название или ИНН"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim().length >= 2 && dq.length >= 2 && (
        <div className={s.results}>
          {hits.isFetching && !items.length && <p className={s.hint}>Ищем…</p>}
          {!hits.isFetching && !items.length && <p className={s.hint}>Никого не нашли. Можно оставить поле пустым</p>}
          {items.map((c) => (
            <button key={c.id} type="button" className={s.hit} onClick={() => onChange(c)}>
              {c.kind === 'legal' ? <Building2 size={18} aria-hidden /> : <UserRound size={18} aria-hidden />}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Новая закупка: что купить, для кого, комментарий. Уйдёт на согласование директору. */
export function PurchaseFormSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [client, setClient] = useState<PurchaseClientHit | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setClient(null);
    setComment('');
    setError('');
  }, [open]);

  const save = async () => {
    setError('');
    if (title.trim().length < 2) return setError('Напишите, что купить');
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>('/purchases', { title: title.trim(), clientId: client?.id ?? null, comment: comment.trim() });
      await inv('purchases', 'purchase', 'notifications');
      toast.success('Заявка на закупку отправлена', 'Директор получил уведомление');
      onClose();
      onCreated(r.id);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Новая закупка"
      subtitle="Заявка уйдёт на согласование директору"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={busy} onClick={save}>
            Отправить на согласование
          </Button>
        </>
      }
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Что купить">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus autoComplete="off" maxLength={200} placeholder="Например: мышь беспроводная" />
        </Field>
        <Field label="Для кого" optional hint="Организация или человек, для кого покупаем">
          <ForWhom value={client} onChange={setClient} />
        </Field>
        <Field label="Комментарий" optional>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} />
        </Field>
      </form>
    </Sheet>
  );
}
