import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, CheckCircle2, ClipboardCheck, FileText, Plus, Printer, Save, UserRound } from 'lucide-react';
import {
  CLIENT_KIND_LABELS,
  formatPhone,
  intakeSchema,
  type Attachment,
  type Client,
  type ClientKind,
  type Contact,
  type FleetRowDto,
  type IntakeInput,
  type IntakeResult,
} from '@sd/shared';
import { useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useClient, useClientDevices, useDictionaries, useInvalidate, useSettings, useUsers } from '@/api/queries';
import { defaultDueDate } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { dueDaysFor } from '@/lib/stages';
import { AttachHint, AttachmentList, UploadButton } from '@/components/Attachments';
import { ClientPicker } from '@/components/ClientPicker';
import { ContactPicker } from '@/components/ContactPicker';
import { FleetEditor, emptyFleetRow, fleetTotals } from '@/components/FleetEditor';
import { DueInput, UserSelect } from '@/components/Pickers';
import { Button } from '@/ui/Button';
import { Accordion, Card, ErrorBox, PageHeader, Spinner } from '@/ui/Display';
import { Field, Input, Segmented, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { DeviceSection } from './DeviceSection';
import s from './Intake.module.css';

const emptyDevice = (): IntakeInput['devices'][number] => ({
  device: {
    id: null,
    deviceTypeId: undefined as unknown as number,
    brandId: null,
    brandText: null,
    modelId: null,
    modelText: null,
    serial: null,
  },
  faultIds: [],
  faultText: null,
  appearance: [],
  appearanceNote: null,
  kit: [],
  kitNote: null,
  devicePassword: null,
  department: null,
});

type ClientMode = 'search' | 'new';

export default function IntakePage() {
  useDocumentTitle('Приём техники');
  const me = useMe();
  const dict = useDictionaries();
  const settings = useSettings();
  const users = useUsers();
  const toast = useToast();
  const inv = useInvalidate();
  const navigate = useNavigate();

  const [kind, setKind] = useState<ClientKind>('person');
  const [client, setClient] = useState<Client | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [mode, setMode] = useState<ClientMode>('search');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fleet, setFleet] = useState<FleetRowDto[] | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [serverError, setServerError] = useState('');

  const form = useForm<IntakeInput>({
    resolver: zodResolver(intakeSchema) as any,
    defaultValues: {
      clientKind: 'person',
      clientId: null,
      newClient: null,
      devices: [emptyDevice()],
      responsibleId: undefined as unknown as number,
      dueAt: '',
      comment: null,
      branch: null,
      requesterName: null,
      contactId: null,
      attachmentIds: [],
      fleet: null,
    },
  });
  const { control, register, setValue, handleSubmit, formState } = form;
  const errors = formState.errors;
  const devices = useFieldArray({ control, name: 'devices' });
  const pastDevices = useClientDevices(client?.id);
  const clientDetail = useClient(kind === 'legal' && client ? client.id : 0);

  const diagnostics = dict.data?.stages.filter((st) => st.isActive)[1];

  // «Принять технику» из карточки клиента: /intake?client=ID
  const [params] = useSearchParams();
  const presetId = Number(params.get('client')) || 0;
  const preset = useClient(presetId);
  useEffect(() => {
    if (!preset.data || client) return;
    const k = preset.data.kind;
    setKind(k);
    setValue('clientKind', k);
    setClient(preset.data);
    setValue('clientId', preset.data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.data]);

  // Ответственный и срок по умолчанию: первый диагност, срок по SLA этапа.
  useEffect(() => {
    if (!users.data || form.getValues('responsibleId')) return;
    const diag = users.data.find((u) => u.role === 'diagnostician' && u.isActive !== false);
    if (diag) setValue('responsibleId', diag.id);
  }, [users.data, form, setValue]);
  useEffect(() => {
    if (settings.data && diagnostics && !form.getValues('dueAt')) {
      setValue('dueAt', defaultDueDate(settings.data.work, dueDaysFor(diagnostics)).toISOString());
    }
  }, [settings.data, diagnostics, form, setValue]);

  // Чек-лист юрлица подтягиваем из карточки клиента.
  useEffect(() => {
    if (kind !== 'legal') return;
    if (client && clientDetail.data) setFleet(clientDetail.data.fleet);
    if (!client) setFleet(null);
  }, [kind, client, clientDetail.data]);

  const switchKind = (k: ClientKind) => {
    setKind(k);
    setClient(null);
    setContact(null);
    setMode('search');
    setValue('clientKind', k);
    setValue('clientId', null);
    setValue('newClient', null);
    if (k === 'person' && devices.fields.length > 1) devices.replace([form.getValues('devices.0')]);
  };

  const pickContact = (c: Contact | null) => {
    setContact(c);
    setValue('contactId', c?.id ?? null);
    setValue('requesterName', c?.fullName ?? null);
  };

  const selectClient = (c: Client | null) => {
    setClient(c);
    pickContact(null);
    setValue('clientId', c?.id ?? null, { shouldValidate: formState.isSubmitted });
    setValue('newClient', null);
  };

  const startNew = (prefill: { name?: string; phone?: string; inn?: string }) => {
    setMode('new');
    setClient(null);
    setValue('clientId', null);
    setValue('newClient', {
      kind,
      name: prefill.name ?? '',
      phone: prefill.phone ?? '',
      phone2: null,
      email: '',
      address: null,
      inn: prefill.inn ?? '',
      kpp: '',
      contactPerson: null,
      note: null,
    } as any);
  };

  // Клиента можно сохранить в базу сразу, не дожидаясь всего приёма: если что-то зависнет, вводить заново не придётся.
  const [savingClient, setSavingClient] = useState(false);
  const saveClient = async () => {
    const nc = form.getValues('newClient');
    if (!nc?.name?.trim()) {
      form.setError('newClient.name' as any, { message: 'Укажите имя или название' });
      return;
    }
    setSavingClient(true);
    try {
      const r = await api.post<{ id: number }>('/clients', { ...nc, kind } as any);
      const saved = await api.get<Client>(`/clients/${r.id}`);
      setMode('search');
      selectClient(saved);
      inv('clients');
      toast.success('Клиент сохранён в базе', 'Можно продолжать приём.');
    } catch (e) {
      const err = e as ApiError;
      if (err.data?.code === 'client_exists' && err.data.clientId) {
        const existing = await api.get<Client>(`/clients/${err.data.clientId}`);
        setMode('search');
        selectClient(existing);
        toast.success('Такой клиент уже есть', 'Выбрали его карточку.');
      } else {
        Object.entries(err.fields ?? {}).forEach(([k, v]) => form.setError(`newClient.${k}` as any, { message: v }));
        toast.error('Не получилось сохранить клиента', err.message);
      }
    } finally {
      setSavingClient(false);
    }
  };

  const submit = handleSubmit(
    async (values) => {
      setServerError('');
      try {
        const payload = {
          ...values,
          clientKind: kind,
          newClient: mode === 'new' && values.newClient ? { ...values.newClient, kind } : null,
          contactId: kind === 'legal' ? (contact?.id ?? null) : null,
          requesterName: kind === 'legal' ? (contact?.fullName ?? values.requesterName) : null,
          attachmentIds: files.map((f) => f.id),
          fleet: kind === 'legal' && fleet ? fleet.filter((r) => r.department.trim()) : null,
        };
        const r = await api.post<IntakeResult>('/intake', payload as any);
        inv('orders', 'dashboard', 'clients', 'tasks');
        setResult(r);
      } catch (e) {
        const err = e as ApiError;
        if (err.data?.code === 'client_exists' && err.data.clientId) {
          setServerError(`${err.message}. Выберите его через поиск — новая карточка не нужна.`);
        } else setServerError(err.message);
        Object.entries(err.fields ?? {}).forEach(([k, v]) => form.setError(k as any, { message: v }));
      }
    },
    () => {
      toast.error('Проверьте форму', 'Некоторые поля заполнены не так');
      requestAnimationFrame(() =>
        document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      );
    },
  );

  const reset = () => {
    setResult(null);
    setClient(null);
    setContact(null);
    setMode('search');
    setFiles([]);
    setFleet(null);
    form.reset({
      ...form.getValues(),
      clientId: null,
      newClient: null,
      devices: [emptyDevice()],
      comment: null,
      branch: null,
      requesterName: null,
      contactId: null,
      attachmentIds: [],
      fleet: null,
    });
    window.scrollTo({ top: 0 });
  };

  const watchedDevices = useWatch({ control, name: 'devices' });
  const responsibleId = useWatch({ control, name: 'responsibleId' });
  const newClient = useWatch({ control, name: 'newClient' });
  const summaryClient = client?.name || (mode === 'new' ? newClient?.name : '') || '';
  const departments = useMemo(() => (fleet ?? []).map((r) => r.department).filter(Boolean), [fleet]);

  if (!dict.data) return <Spinner />;

  const responsibleName = users.data?.find((u) => u.id === Number(responsibleId))?.fullName;
  const deviceNames = (watchedDevices ?? [])
    .map((d) => dict.data!.deviceTypes.find((t) => t.id === Number(d?.device?.deviceTypeId))?.name)
    .filter(Boolean);
  const clientError = (errors.clientId?.message as string) || '';
  const nc = errors.newClient as any;

  return (
    <form onSubmit={submit} noValidate className={s.page}>
      <PageHeader
        title="Приём техники"
        subtitle="Одна форма: клиент, техника, состояние. Квитанция и задача на диагностику создадутся сами."
      />

      <div className={s.layout}>
        <div className={s.main}>
          <Segmented
            block
            label="Кто сдаёт технику"
            layoutId="intake-kind"
            value={kind}
            onChange={switchKind}
            options={[
              { value: 'person', label: CLIENT_KIND_LABELS.person, icon: <UserRound aria-hidden /> },
              { value: 'legal', label: CLIENT_KIND_LABELS.legal, icon: <Building2 aria-hidden /> },
            ]}
          />

          {serverError && <ErrorBox>{serverError}</ErrorBox>}

          <Card>
            <h2 className={s.sectionTitle}>
              <span className={s.sectionNum}>01</span>
              {kind === 'legal' ? 'Организация' : 'Клиент'}
            </h2>
            {mode === 'search' ? (
              <>
                <ClientPicker
                  kind={kind}
                  selected={client}
                  onSelect={selectClient}
                  onCreateNew={startNew}
                  invalid={Boolean(clientError)}
                />
                {clientError && <p className={s.error}>{clientError}</p>}
              </>
            ) : (
              <div className="stack">
                <div className={formStyles.grid2}>
                  <Field
                    label={kind === 'legal' ? 'Название организации' : 'Имя и фамилия'}
                    error={nc?.name?.message}
                    className={kind === 'legal' ? formStyles.span2 : undefined}
                  >
                    <Input
                      {...register('newClient.name')}
                      autoComplete={kind === 'legal' ? 'organization' : 'name'}
                      enterKeyHint="next"
                      data-autofocus
                    />
                  </Field>
                  {kind === 'legal' && (
                    <>
                      <Field label="ИНН" optional error={nc?.inn?.message}>
                        <Input {...register('newClient.inn')} inputMode="numeric" maxLength={12} autoComplete="off" />
                      </Field>
                      <Field label="КПП" optional error={nc?.kpp?.message}>
                        <Input {...register('newClient.kpp')} inputMode="numeric" maxLength={9} autoComplete="off" />
                      </Field>
                    </>
                  )}
                  <Field label="Телефон" optional={kind === 'legal'} error={nc?.phone?.message}>
                    <Input
                      {...register('newClient.phone')}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+7 900 000-00-00"
                    />
                  </Field>
                  <Field label="Почта" optional error={nc?.email?.message}>
                    <Input {...register('newClient.email')} type="email" inputMode="email" autoComplete="email" />
                  </Field>
                  {kind === 'legal' && (
                    <Field label="Адрес" optional className={formStyles.span2}>
                      <Input {...register('newClient.address')} autoComplete="street-address" />
                    </Field>
                  )}
                </div>
                <div className="row wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Save size={16} aria-hidden />}
                    loading={savingClient}
                    onClick={saveClient}
                  >
                    Сохранить клиента
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMode('search');
                      setValue('newClient', null);
                    }}
                  >
                    Найти в базе
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h2 className={s.sectionTitle}>
              <span className={s.sectionNum}>02</span>
              Техника
            </h2>
            <div className={s.devices}>
              {devices.fields.map((f, i) => (
                <DeviceSection
                  key={f.id}
                  index={i}
                  control={control}
                  setValue={setValue}
                  errors={errors}
                  dict={dict.data!}
                  pastDevices={pastDevices.data ?? []}
                  legal={kind === 'legal'}
                  departments={departments}
                  canRemove={devices.fields.length > 1}
                  onRemove={() => devices.remove(i)}
                  total={devices.fields.length}
                />
              ))}
            </div>
            {kind === 'legal' && (
              <Button
                variant="secondary"
                icon={<Plus size={18} aria-hidden />}
                onClick={() => devices.append(emptyDevice())}
                className={s.addDevice}
              >
                Ещё техника в этот приём
              </Button>
            )}
          </Card>

          {kind === 'legal' && (
            <Card>
              <Accordion
                title={<span className={s.accTitle}>Чек-лист парка техники</span>}
                meta={fleet?.length ? `${fleetTotals(fleet).pc} ПК, ${fleetTotals(fleet).mfu} МФУ` : 'не заполнен'}
              >
                <FleetEditor rows={fleet ?? [emptyFleetRow()]} onChange={setFleet} />
              </Accordion>
            </Card>
          )}

          <Card>
            <h2 className={s.sectionTitle}>
              <span className={s.sectionNum}>03</span>
              Диагностика
            </h2>
            <div className="stack">
              <div className={formStyles.grid2}>
                <Field label="Ответственный" error={errors.responsibleId?.message}>
                  <UserSelect {...register('responsibleId')} preferRoles={['diagnostician', 'master']} />
                </Field>
                <Field
                  label="Срок"
                  error={errors.dueAt?.message}
                  hint={`Рабочий день до ${settings.data?.work.workEnd ?? '20:00'}`}
                >
                  <Controller
                    control={control}
                    name="dueAt"
                    render={({ field }) => <DueInput value={field.value} onChange={field.onChange} />}
                  />
                </Field>
              </div>
              {kind === 'legal' && (
                <div className="stack">
                  <Field label="Кто подал заявку" optional group hint="Человек из организации: подсказки из базы по первым буквам ФИО">
                    <div>
                      {client ? (
                        <ContactPicker clientId={client.id} value={contact} onChange={pickContact} />
                      ) : (
                        <p className="muted">Сначала выберите или сохраните организацию.</p>
                      )}
                    </div>
                  </Field>
                  <Field label="Филиал" optional hint="Если у организации несколько филиалов">
                    <Input {...register('branch')} placeholder="Например: Красноуральск" />
                  </Field>
                </div>
              )}
              <Field label="Комментарий к приёму" optional>
                <Textarea {...register('comment')} rows={2} placeholder="Например: клиент просит позвонить до ремонта" />
              </Field>
              <Field label="Фото и документы" optional group>
                <div className="stack" style={{ gap: 'var(--s-3)' }}>
                  <AttachmentList items={files} compact onDeleted={(id) => setFiles((l) => l.filter((f) => f.id !== id))} />
                  <div className="row wrap">
                    <UploadButton target={{}} onUploaded={(items) => setFiles((l) => [...l, ...items])} label="Прикрепить" />
                    <AttachHint />
                  </div>
                </div>
              </Field>
            </div>
          </Card>
        </div>

        <aside className={s.aside}>
          <div className={s.summary}>
            <p className={s.summaryLabel}>Квитанция</p>
            <dl className={s.summaryDl}>
              <dt>{kind === 'legal' ? 'Организация' : 'Клиент'}</dt>
              <dd>{summaryClient || <span className={s.missing}>не выбран</span>}</dd>
              {client?.phone && (
                <>
                  <dt>Телефон</dt>
                  <dd>{formatPhone(client.phone)}</dd>
                </>
              )}
              <dt>Техника</dt>
              <dd>{deviceNames.length ? deviceNames.join(', ') : <span className={s.missing}>тип не выбран</span>}</dd>
              <dt>Диагностика</dt>
              <dd>{responsibleName ?? '—'}</dd>
            </dl>
          </div>
          <div className={s.saveBar}>
            <Button type="submit" block loading={formState.isSubmitting} icon={<Save size={18} aria-hidden />}>
              Сохранить приём
            </Button>
          </div>
        </aside>
      </div>

      <Sheet
        open={Boolean(result)}
        onClose={reset}
        title="Техника принята"
        width={480}
        footer={
          <>
            <Button variant="secondary" onClick={reset} icon={<Plus size={18} aria-hidden />}>
              Принять ещё
            </Button>
            <Button onClick={() => navigate(`/orders/${result!.orderIds[0]}`)} icon={<ClipboardCheck size={18} aria-hidden />}>
              Открыть заявку
            </Button>
          </>
        }
      >
        {result && (
          <div className={s.done}>
            <CheckCircle2 className={s.doneIcon} aria-hidden />
            <p>
              {result.orderNumbers.length > 1 ? 'Заявки' : 'Заявка'} <b>№{result.orderNumbers.join(', №')}</b> на диагностике.
              {responsibleName && responsibleName !== me.fullName ? ` ${responsibleName} получит уведомление о задаче.` : ''}
            </p>
            <a href={result.receiptUrl} target="_blank" rel="noreferrer" className={s.receipt}>
              <Printer aria-hidden />
              <span>
                <b>Квитанция о приёме</b>
                <span>Открыть PDF и распечатать</span>
              </span>
              <FileText aria-hidden className={s.receiptArrow} />
            </a>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              Все заявки — в разделе <Link to="/orders">Заявки</Link>.
            </p>
          </div>
        )}
      </Sheet>
    </form>
  );
}
