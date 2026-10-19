import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { formStyles } from '@/ui/Form';

/** Заправка картриджей по клиенту: считаем по количеству, без привязки к конкретной технике. */
export function RefillSheet({ clientId, open, onClose }: { clientId: number; open: boolean; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setQty('1');
    setError('');
  }, [open]);

  const save = async () => {
    setError('');
    if (title.trim().length < 2) return setError('Напишите модель картриджа');
    setBusy(true);
    try {
      await api.post('/works', { clientId, kind: 'refill', title: title.trim(), qty: Number(qty) || 1 });
      inv('clients', 'orders');
      toast.success('Заправка записана');
      onClose();
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
      title="Заправка картриджей"
      subtitle="Попадёт в помесячный отчёт по клиенту"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} loading={busy} icon={<Plus size={18} aria-hidden />}>
            Записать
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className={formStyles.grid2}>
          <Field label="Модель картриджа" className={formStyles.span2}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: CF259A" data-autofocus maxLength={200} />
          </Field>
          <Field label="Сколько штук">
            <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
