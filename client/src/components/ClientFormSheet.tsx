import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { clientSchema, type Client, type ClientInput, type ClientKind } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Segmented, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';

export function ClientFormSheet({
  open,
  onClose,
  client,
  defaultKind = 'person',
}: {
  open: boolean;
  onClose: () => void;
  client?: Client;
  defaultKind?: ClientKind;
}) {
  const inv = useInvalidate();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useForm<ClientInput>({ resolver: zodResolver(clientSchema) as any });
  const kind = form.watch('kind');
  const e = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset({
      kind: client?.kind ?? defaultKind,
      name: client?.name ?? '',
      phone: client?.phone ?? '',
      phone2: client?.phone2 ?? '',
      email: client?.email ?? '',
      address: client?.address ?? '',
      inn: client?.inn ?? '',
      kpp: client?.kpp ?? '',
      contactPerson: client?.contactPerson ?? '',
      note: client?.note ?? '',
    });
  }, [open, client, defaultKind, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      if (client) {
        await api.put(`/clients/${client.id}`, values as any);
        toast.success('Клиент сохранён');
      } else {
        const r = await api.post<{ id: number }>('/clients', values as any);
        toast.success('Клиент добавлен');
        navigate(`/clients/${r.id}`);
      }
      inv('clients', 'client', 'orders', 'order');
      onClose();
    } catch (err) {
      const ae = err as ApiError;
      Object.entries(ae.fields ?? {}).forEach(([k, v]) => form.setError(k as any, { message: v }));
      form.setError('root', { message: ae.message });
    }
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={client ? 'Изменить клиента' : 'Новый клиент'}
      full
      width={620}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            Сохранить
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="stack" noValidate>
        {e.root?.message && <ErrorBox>{e.root.message}</ErrorBox>}
        <Segmented
          block
          label="Тип клиента"
          layoutId="client-kind"
          value={kind ?? 'person'}
          onChange={(v) => form.setValue('kind', v)}
          options={[
            { value: 'person', label: 'Физлицо' },
            { value: 'legal', label: 'Юрлицо' },
          ]}
        />
        <div className={formStyles.grid2}>
          <Field label={kind === 'legal' ? 'Название' : 'Имя и фамилия'} error={e.name?.message} className={formStyles.span2}>
            <Input {...form.register('name')} autoComplete={kind === 'legal' ? 'organization' : 'name'} />
          </Field>
          {kind === 'legal' && (
            <>
              <Field label="ИНН" optional error={e.inn?.message}>
                <Input {...form.register('inn')} inputMode="numeric" maxLength={12} />
              </Field>
              <Field label="КПП" optional error={e.kpp?.message}>
                <Input {...form.register('kpp')} inputMode="numeric" maxLength={9} />
              </Field>
              <Field label="Контактное лицо" error={e.contactPerson?.message} className={formStyles.span2}>
                <Input {...form.register('contactPerson')} />
              </Field>
            </>
          )}
          <Field label="Телефон" optional={kind === 'legal'} error={e.phone?.message}>
            <Input {...form.register('phone')} type="tel" inputMode="tel" autoComplete="tel" />
          </Field>
          <Field label="Доп. телефон" optional error={e.phone2?.message}>
            <Input {...form.register('phone2')} type="tel" inputMode="tel" />
          </Field>
          <Field label="Почта" optional error={e.email?.message}>
            <Input {...form.register('email')} type="email" inputMode="email" autoComplete="email" />
          </Field>
          <Field label="Адрес" optional error={e.address?.message}>
            <Input {...form.register('address')} autoComplete="street-address" />
          </Field>
          <Field label="Заметка" optional className={formStyles.span2}>
            <Textarea {...form.register('note')} rows={3} />
          </Field>
        </div>
      </form>
    </Sheet>
  );
}
