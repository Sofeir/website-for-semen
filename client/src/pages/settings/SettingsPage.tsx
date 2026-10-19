import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Save, UserPlus } from 'lucide-react';
import {
  ROLE_LABELS,
  STAFF_ROLES,
  companySettingsSchema,
  userCreateSchema,
  workSettingsSchema,
  type CompanySettings,
  type UserBrief,
  type UserCreateInput,
  type WorkSettings,
} from '@sd/shared';
import { useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { keys, useDictionaries, useInvalidate, useSettings, useUsers } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, IconButton } from '@/ui/Button';
import { Avatar, Card, ErrorBox, PageHeader, Pill, Spinner, Tabs } from '@/ui/Display';
import { Checkbox, Field, Input, Select, Textarea, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { DictionaryEditor, useDictConfigs } from './DictionaryEditor';
import { ImportPanel } from './ImportPanel';
import s from './Settings.module.css';

type Section = 'dict' | 'users' | 'company' | 'work' | 'import';

export default function SettingsPage() {
  useDocumentTitle('Настройки');
  const [section, setSection] = useState<Section>('dict');
  return (
    <>
      <PageHeader title="Настройки" subtitle="Справочники, сотрудники, реквизиты для документов и импорт старой базы." />
      <div className={s.tabs}>
        <Tabs
          label="Разделы настроек"
          value={section}
          onChange={setSection}
          items={[
            { value: 'dict', label: 'Справочники' },
            { value: 'users', label: 'Сотрудники' },
            { value: 'company', label: 'Реквизиты и документы' },
            { value: 'work', label: 'Рабочее время' },
            { value: 'import', label: 'Импорт из Excel' },
          ]}
        />
      </div>
      {section === 'dict' && <Dictionaries />}
      {section === 'users' && <Users />}
      {section === 'company' && <Company />}
      {section === 'work' && <Work />}
      {section === 'import' && <ImportPanel />}
    </>
  );
}

function Dictionaries() {
  const dict = useDictionaries();
  const configs = useDictConfigs();
  const [active, setActive] = useState('device_types');
  if (!dict.data) return <Spinner />;
  const map: Record<string, any[]> = {
    device_types: dict.data.deviceTypes,
    brands: dict.data.brands,
    models: dict.data.models,
    faults: dict.data.faults,
    appearance: dict.data.appearance,
    kit: dict.data.kit,
    services: dict.data.services,
    warranties: dict.data.warranties,
    stages: dict.data.stages,
  };
  const current = configs.find((c) => c.name === active)!;
  return (
    <div className={s.dictLayout}>
      <nav className={s.dictNav} aria-label="Справочники">
        {configs.map((c) => (
          <button
            key={c.name}
            type="button"
            className={s.dictNavItem}
            aria-current={c.name === active ? 'page' : undefined}
            onClick={() => setActive(c.name)}
          >
            {c.title}
            <span className="num muted">{map[c.name].length}</span>
          </button>
        ))}
      </nav>
      <Card>{current && <DictionaryEditor key={current.name} config={current} items={map[current.name]} />}</Card>
    </div>
  );
}

function Users() {
  const users = useUsers();
  const me = useMe();
  const inv = useInvalidate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<UserBrief | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const update = async (u: UserBrief, patch: Record<string, unknown>) => {
    try {
      await api.put(`/users/${u.id}`, patch);
      inv('users');
      toast.success('Сохранено');
    } catch (e) {
      toast.error('Не сохранилось', (e as ApiError).message);
    }
  };

  if (!users.data) return <Spinner />;
  return (
    <Card>
      <div className={s.dictHead}>
        <h3 className={s.dictTitle}>Сотрудники и роли</h3>
        <Button size="sm" icon={<UserPlus size={16} aria-hidden />} onClick={() => setCreating(true)}>
          Добавить сотрудника
        </Button>
      </div>
      <ul className={s.users}>
        {users.data.map((u) => (
          <li key={u.id} className={s.user} data-inactive={u.isActive === false}>
            <Avatar name={u.fullName} size={40} />
            <div className={s.userMain}>
              <b>
                {u.fullName} {u.id === me.id && <Pill tone="outline">это вы</Pill>}
              </b>
              <span>логин {u.login}</span>
              {u.roleConfirmed === false && (
                <span className="row wrap" style={{ gap: 'var(--s-2)', marginTop: 4 }}>
                  <Pill tone="amber" dot>
                    Роль не уточнена — проверьте и выберите верную
                  </Pill>
                  <Button variant="ghost" size="sm" onClick={() => update(u, { roleConfirmed: true })}>
                    Роль верна
                  </Button>
                </span>
              )}
            </div>
            <Select
              aria-label={`Роль: ${u.fullName}`}
              value={u.role}
              disabled={u.id === me.id}
              onChange={(e) => update(u, { role: e.target.value })}
              className={s.roleSelect}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Checkbox
              label="Активен"
              checked={u.isActive !== false}
              disabled={u.id === me.id}
              onChange={(e) => update(u, { isActive: e.target.checked })}
            />
            <IconButton
              label={`Новый пароль для ${u.fullName}`}
              onClick={() => {
                setResetFor(u);
                setNewPassword('');
              }}
            >
              <KeyRound />
            </IconButton>
          </li>
        ))}
      </ul>
      <UserCreateSheet open={creating} onClose={() => setCreating(false)} />
      <Sheet
        open={Boolean(resetFor)}
        onClose={() => setResetFor(null)}
        title="Новый пароль"
        subtitle={resetFor?.fullName}
        width={440}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetFor(null)}>
              Отмена
            </Button>
            <Button
              disabled={newPassword.length < 8}
              onClick={async () => {
                await update(resetFor!, { password: newPassword });
                setResetFor(null);
              }}
            >
              Сохранить пароль
            </Button>
          </>
        }
      >
        <Field label="Пароль" hint="От 8 символов. Сотрудника выкинет из системы на всех устройствах.">
          <Input
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            data-autofocus
          />
        </Field>
      </Sheet>
    </Card>
  );
}

function UserCreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const form = useForm<UserCreateInput>({
    resolver: zodResolver(userCreateSchema) as any,
    defaultValues: { role: 'diagnostician' },
  });
  const e = form.formState.errors;
  useEffect(() => {
    if (open) form.reset({ login: '', fullName: '', role: 'diagnostician', phone: '', password: '' });
  }, [open, form]);
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/users', v as any);
      inv('users');
      toast.success('Сотрудник добавлен');
      onClose();
    } catch (err) {
      const ae = err as ApiError;
      Object.entries(ae.fields ?? {}).forEach(([k, m]) => form.setError(k as any, { message: m }));
      form.setError('root', { message: ae.message });
    }
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Новый сотрудник"
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            Добавить
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        {e.root?.message && <ErrorBox>{e.root.message}</ErrorBox>}
        <Field label="Имя" error={e.fullName?.message}>
          <Input {...form.register('fullName')} data-autofocus />
        </Field>
        <Field label="Роль">
          <Select {...form.register('role')}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <div className={formStyles.grid2}>
          <Field label="Логин" error={e.login?.message} hint="Латиницей">
            <Input {...form.register('login')} autoCapitalize="none" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Пароль" error={e.password?.message} hint="От 8 символов">
            <Input {...form.register('password')} type="text" autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Телефон" optional>
          <Input {...form.register('phone')} type="tel" inputMode="tel" />
        </Field>
      </form>
    </Sheet>
  );
}

function Company() {
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<CompanySettings>({ resolver: zodResolver(companySettingsSchema) as any });
  useEffect(() => {
    if (settings.data) form.reset(settings.data.company);
  }, [settings.data, form]);
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.put('/settings/company', v as any);
      qc.invalidateQueries({ queryKey: keys.settings });
      toast.success('Реквизиты сохранены', 'Новые PDF соберутся уже с ними');
    } catch (err) {
      toast.error('Не сохранилось', (err as ApiError).message);
    }
  });
  if (!settings.data) return <Spinner />;
  return (
    <Card>
      <form className="stack" onSubmit={submit} noValidate>
        <h3 className={s.dictTitle}>Шапка документов</h3>
        <div className={formStyles.grid2}>
          <Field label="Название сервиса" error={e.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Юрлицо" optional>
            <Input {...form.register('legalName')} placeholder="ООО «…» или ИП …" />
          </Field>
          <Field label="ИНН" optional>
            <Input {...form.register('inn')} inputMode="numeric" />
          </Field>
          <Field label="КПП" optional>
            <Input {...form.register('kpp')} inputMode="numeric" />
          </Field>
          <Field label="ОГРН" optional>
            <Input {...form.register('ogrn')} inputMode="numeric" />
          </Field>
          <Field label="Телефон" optional>
            <Input {...form.register('phone')} type="tel" />
          </Field>
          <Field label="Адрес" optional className={formStyles.span2}>
            <Input {...form.register('address')} />
          </Field>
          <Field label="Почта" optional>
            <Input {...form.register('email')} type="email" />
          </Field>
          <Field label="Сайт" optional>
            <Input {...form.register('site')} />
          </Field>
          <Field label="Режим работы" optional className={formStyles.span2}>
            <Input {...form.register('workHours')} />
          </Field>
        </div>
        <h3 className={s.dictTitle}>Тексты документов</h3>
        <Field label="Условия в квитанции" optional hint="Пусто — печатаем стандартный текст">
          <Textarea {...form.register('receiptTerms')} rows={5} />
        </Field>
        <Field label="Условия в акте" optional hint="Пусто — печатаем стандартный текст">
          <Textarea {...form.register('actTerms')} rows={4} />
        </Field>
        <Field label="Текст о скидке при повторном обращении" optional hint="Печатается, только если в акте стоит галочка">
          <Input {...form.register('repeatDiscountText')} />
        </Field>
        <div>
          <Button type="submit" icon={<Save size={18} aria-hidden />} loading={form.formState.isSubmitting}>
            Сохранить
          </Button>
        </div>
      </form>
    </Card>
  );
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function Work() {
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<WorkSettings>({ resolver: zodResolver(workSettingsSchema) as any });
  useEffect(() => {
    if (settings.data) form.reset(settings.data.work);
  }, [settings.data, form]);
  const days = form.watch('workDays') ?? [];
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.put('/settings/work', v as any);
      qc.invalidateQueries({ queryKey: keys.settings });
      toast.success('Рабочее время сохранено');
    } catch (err) {
      toast.error('Не сохранилось', (err as ApiError).message);
    }
  });
  if (!settings.data) return <Spinner />;
  return (
    <Card>
      <form className="stack" onSubmit={submit} noValidate>
        <p className={s.dictHint}>
          Сроки задач позже конца рабочего дня переносятся на его конец. Срок по умолчанию — конец рабочего дня через N рабочих
          дней.
        </p>
        <div className={formStyles.grid3}>
          <Field label="Начало дня" error={e.workStart?.message}>
            <Input type="time" {...form.register('workStart')} />
          </Field>
          <Field label="Конец дня" error={e.workEnd?.message}>
            <Input type="time" {...form.register('workEnd')} />
          </Field>
          <Field label="Срок по умолчанию, рабочих дней" error={e.defaultDueDays?.message}>
            <Input inputMode="numeric" {...form.register('defaultDueDays')} />
          </Field>
        </div>
        <Field label="Рабочие дни" group error={e.workDays?.message}>
          <div className={s.days}>
            {DAYS.map((d, i) => (
              <Checkbox
                key={d}
                label={d}
                checked={days.includes(i + 1)}
                onChange={(ev) =>
                  form.setValue('workDays', ev.target.checked ? [...days, i + 1].sort() : days.filter((x) => x !== i + 1), {
                    shouldDirty: true,
                  })
                }
              />
            ))}
          </div>
        </Field>
        <div>
          <Button type="submit" icon={<Save size={18} aria-hidden />} loading={form.formState.isSubmitting}>
            Сохранить
          </Button>
        </div>
      </form>
    </Card>
  );
}
