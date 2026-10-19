import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, CheckCircle2, Eye, EyeOff, UserRound, UserPlus } from 'lucide-react';
import { registerSchema, type RegisterInput } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { Brand } from '@/layout/Brand';
import { Button, ButtonLink } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Segmented } from '@/ui/Form';
import { useDocumentTitle } from '@/lib/hooks';
import s from './LoginPage.module.css';

/** Регистрация заказчика. После отправки руководитель проверяет данные и открывает доступ. */
export default function RegisterPage() {
  useDocumentTitle('Регистрация заказчика');
  const { user, appName } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema) as any,
    defaultValues: { kind: 'person', fullName: '', contactPerson: '', phone: '', email: '', login: '', password: '' },
  });
  const kind = form.watch('kind');
  const errors = form.formState.errors;

  if (user) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError('');
    try {
      await api.post('/auth/register', values as any);
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        for (const [name, msg] of Object.entries(e.fields)) form.setError(name as keyof RegisterInput, { message: String(msg) });
      }
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить заявку');
    }
  });

  return (
    <div className={s.page}>
      <section className={s.plate} aria-hidden>
        <span className={s.watermark}>ASOFT</span>
        <div className={s.plateInner}>
          <ol className={s.flow}>
            {['Регистрация', 'Подтверждение', 'Ваши задачи'].map((st, i) => (
              <li key={st}>
                <span className={s.flowNum}>{String(i + 1).padStart(2, '0')}</span>
                {st}
              </li>
            ))}
          </ol>
          <p className={s.plateText}>Ставьте задачи сервис-центру и следите за ними в своём кабинете.</p>
        </div>
      </section>

      <section className={s.formSide}>
        <div className={s.card}>
          <Brand name={appName} className={s.brand} />
          {sent ? (
            <div className="stack">
              <h1 className={s.title}>Заявка отправлена</h1>
              <p style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-start' }}>
                <CheckCircle2 aria-hidden style={{ color: 'var(--teal-600)', flex: 'none' }} />
                <span>
                  Руководитель проверит данные и откроет доступ. Мы свяжемся с вами по указанному телефону. После этого вы сможете войти с
                  выбранным логином и паролем.
                </span>
              </p>
              <ButtonLink to="/login" block>
                К входу
              </ButtonLink>
            </div>
          ) : (
            <>
              <h1 className={s.title}>Регистрация заказчика</h1>
              <form onSubmit={onSubmit} className={s.form} noValidate>
                {error && <ErrorBox>{error}</ErrorBox>}
                <Controller
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <Segmented
                      label="Кто вы"
                      value={field.value}
                      onChange={field.onChange}
                      block
                      layoutId="register-kind"
                      options={[
                        { value: 'person', label: 'Физлицо', icon: <UserRound /> },
                        { value: 'legal', label: 'Организация', icon: <Building2 /> },
                      ]}
                    />
                  )}
                />
                <Field label={kind === 'legal' ? 'Название организации' : 'Ваше имя'} error={errors.fullName?.message}>
                  <Input autoComplete="name" {...form.register('fullName')} />
                </Field>
                {kind === 'legal' && (
                  <Field label="Контактное лицо" optional error={errors.contactPerson?.message}>
                    <Input {...form.register('contactPerson')} />
                  </Field>
                )}
                <Field label="Телефон для связи" error={errors.phone?.message}>
                  <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+7" {...form.register('phone')} />
                </Field>
                <Field label="Почта" optional error={errors.email?.message}>
                  <Input type="email" autoComplete="email" {...form.register('email')} />
                </Field>
                <Field label="Логин для входа" hint="Латиница, цифры, точка, дефис" error={errors.login?.message}>
                  <Input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} {...form.register('login')} />
                </Field>
                <Field label="Пароль" hint="От 8 символов" error={errors.password?.message}>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    {...form.register('password')}
                    trailing={
                      <button
                        type="button"
                        className={s.eye}
                        aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      </button>
                    }
                  />
                </Field>
                <Button type="submit" block loading={form.formState.isSubmitting} icon={<UserPlus size={18} aria-hidden />}>
                  Отправить заявку
                </Button>
              </form>
              <p className={s.help}>
                Уже есть доступ? <Link to="/login">Войти</Link>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
