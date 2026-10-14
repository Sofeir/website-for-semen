import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { loginSchema, type LoginInput } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { ApiError } from '@/api/http';
import { Brand } from '@/layout/Brand';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Checkbox, Field, Input } from '@/ui/Form';
import { useDocumentTitle } from '@/lib/hooks';
import { DemoPanel } from './DemoPanel';
import s from './LoginPage.module.css';

export default function LoginPage() {
  useDocumentTitle('Вход');
  const { user, login, appName } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema) as any,
    defaultValues: { login: '', password: '', remember: true },
  });
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (user) return <Navigate to={from} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError('');
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось войти');
    }
  });

  return (
    <div className={s.page}>
      <section className={s.plate} aria-hidden>
        <span className={s.watermark}>ASOFT</span>
        <div className={s.plateInner}>
          <ol className={s.flow}>
            {['Приём', 'Диагностика', 'Согласование', 'Ремонт', 'Готово', 'Выдача'].map((st, i) => (
              <li key={st}>
                <span className={s.flowNum}>{String(i + 1).padStart(2, '0')}</span>
                {st}
              </li>
            ))}
          </ol>
          <p className={s.plateText}>Техника, задачи и документы сервис-центра в одном окне.</p>
        </div>
      </section>

      <section className={s.formSide}>
        <div className={s.card}>
          <Brand name={appName} className={s.brand} />
          <h1 className={s.title}>Вход для сотрудников</h1>
          <form onSubmit={onSubmit} className={s.form} noValidate>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Field label="Логин" error={form.formState.errors.login?.message}>
              <Input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                {...form.register('login')}
              />
            </Field>
            <Field label="Пароль" error={form.formState.errors.password?.message}>
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                enterKeyHint="go"
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
            <Checkbox label="Запомнить меня на этом устройстве" {...form.register('remember')} />
            <Button type="submit" block loading={form.formState.isSubmitting} icon={<LogIn size={18} aria-hidden />}>
              Войти
            </Button>
          </form>
          {import.meta.env.VITE_DEMO ? (
            <DemoPanel
              onPick={(login, password) => {
                form.setValue('login', login);
                form.setValue('password', password);
                setError('');
              }}
            />
          ) : (
            <p className={s.help}>Забыли пароль? Его сбросит администратор сервиса.</p>
          )}
        </div>
      </section>
    </div>
  );
}
