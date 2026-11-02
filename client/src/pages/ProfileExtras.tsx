import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { AtSign, CalendarDays, Check, Copy, MonitorSmartphone } from 'lucide-react';
import { changeLoginSchema, type ChangeLoginInput, type Me } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { keys } from '@/api/queries';
import { installApp, isIos, useInstallState } from '@/lib/installApp';
import { Button } from '@/ui/Button';
import { Card, CardHead, ErrorBox } from '@/ui/Display';
import { Field, Input } from '@/ui/Form';
import { useConfirm } from '@/ui/Confirm';
import { useToast } from '@/ui/Toast';
import s from './ProfilePage.module.css';

/** Смена логина по текущему паролю. Вход в сервис остаётся, но дальше входить нужно уже с новым логином. */
export function LoginCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<ChangeLoginInput>({ resolver: zodResolver(changeLoginSchema) as any, defaultValues: { login: me.login, current: '' } });
  const e = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    if (values.login.toLowerCase() === me.login.toLowerCase() && values.login === me.login) {
      form.setError('login', { message: 'Это ваш нынешний логин' });
      return;
    }
    try {
      const updated = await api.post<Me>('/auth/me/login', values);
      qc.setQueryData(keys.me, (old: any) => (old ? { ...old, user: updated } : old));
      toast.success('Логин изменён', `Теперь входите как ${updated.login}`);
      form.reset({ login: updated.login, current: '' });
    } catch (err) {
      const ae = err as ApiError;
      Object.entries(ae.fields ?? {}).forEach(([k, m]) => form.setError(k as any, { message: m }));
      if (!ae.fields) form.setError('root', { message: ae.message });
    }
  });

  return (
    <Card>
      <CardHead title="Логин" />
      <form className="stack" onSubmit={submit} noValidate>
        {e.root?.message && <ErrorBox>{e.root.message}</ErrorBox>}
        <Field label="Новый логин" error={e.login?.message} hint="Латиница, цифры, точка, дефис. С этим логином вы будете входить в сервис">
          <Input autoComplete="username" autoCapitalize="none" spellCheck={false} {...form.register('login')} />
        </Field>
        <Field label="Текущий пароль" error={e.current?.message} hint="Подтверждаем, что это вы">
          <Input type="password" autoComplete="current-password" {...form.register('current')} />
        </Field>
        <div>
          <Button type="submit" variant="secondary" icon={<AtSign size={18} aria-hidden />} loading={form.formState.isSubmitting}>
            Сменить логин
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Установка сайта как приложения: отдельное окно со своим значком, без адресной строки. */
export function InstallCard() {
  const state = useInstallState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    try {
      if (await installApp()) toast.success('Приложение установлено', 'Значок появился на рабочем столе или в списке программ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="Приложение" />
      <div className={s.extra}>
        <MonitorSmartphone aria-hidden className={s.channelIcon} />
        <div className={s.channelMain}>
          {state === 'installed' && <p>Вы уже пользуетесь сервисом как приложением.</p>}
          {state === 'prompt' && (
            <>
              <p>Сервис откроется в отдельном окне со своим значком, как обычная программа. Без вкладок и адресной строки.</p>
              <div>
                <Button onClick={install} loading={busy} icon={<MonitorSmartphone size={18} aria-hidden />}>
                  Установить как приложение
                </Button>
              </div>
            </>
          )}
          {(state === 'manual' || state === 'insecure') && (
            <>
              <p>Сервис можно открывать отдельным окном со своим значком, как обычную программу.</p>
              {isIos() ? (
                <ol className={s.steps}>
                  <li>Откройте сервис в Safari.</li>
                  <li>Нажмите «Поделиться» внизу экрана.</li>
                  <li>Выберите «На экран “Домой”».</li>
                </ol>
              ) : (
                <ol className={s.steps}>
                  <li>В Chrome нажмите меню ⋮ в правом верхнем углу.</li>
                  <li>
                    {state === 'insecure'
                      ? 'Выберите «Сохранить и поделиться» → «Создать ярлык…».'
                      : 'Выберите «Установить ASOFT Сервис» (или «Сохранить и поделиться» → «Создать ярлык…»).'}
                  </li>
                  {state === 'insecure' && <li>Поставьте галочку «Открывать в отдельном окне» и нажмите «Создать».</li>}
                </ol>
              )}
              {state === 'insecure' && (
                <p className={s.channelHint}>
                  Кнопка «Установить» появится сама, когда сайт будет открываться по защищённому адресу (https). Сейчас браузер её не разрешает.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Ссылка на календарь задач: её подписывают в Google Календаре, iCloud и других, и сроки задач появляются там сами. */
export function CalendarCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<{ token: string | null }>('/auth/me/calendar')
      .then((r) => setToken(r.token))
      .catch(() => setToken(null));
  }, []);

  const url = token ? `${window.location.origin}/api/calendar/${token}.ics` : '';
  const webcal = url.replace(/^https?:/, 'webcal:');

  const create = async (replace: boolean) => {
    if (replace) {
      const ok = await confirm({
        title: 'Заменить ссылку?',
        body: 'Прежняя ссылка перестанет работать. Календарь придётся подключить заново по новой.',
        confirm: 'Заменить',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setToken((await api.post<{ token: string }>('/auth/me/calendar')).token);
      setCopied(false);
      toast.success(replace ? 'Ссылка заменена' : 'Ссылка создана');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const ok = await confirm({
      title: 'Отключить календарь?',
      body: 'Ссылка перестанет работать, новые задачи в календарь попадать не будут. Включить заново можно в любой момент.',
      confirm: 'Отключить',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del('/auth/me/calendar');
      setToken(null);
      toast.success('Календарь отключён');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не скопировалось', 'Выделите ссылку и скопируйте вручную');
    }
  };

  return (
    <Card>
      <CardHead title="Календарь задач" />
      <div className={s.extra}>
        <CalendarDays aria-hidden className={s.channelIcon} />
        <div className={s.channelMain}>
          <p>
            Подключите ссылку к Google Календарю, iCloud или другому календарю: задачи, где вы ответственный, появятся в нём со сроком.
            Закрытые задачи из календаря пропадают.
          </p>
          {import.meta.env.VITE_DEMO && (
            <p className={s.channelHint}>В демо-версии ссылка только показана для примера: подписаться по ней нельзя. В рабочей версии на сервере всё работает.</p>
          )}
          {token === undefined && <p className="muted">Загружаем…</p>}
          {token === null && (
            <div>
              <Button onClick={() => create(false)} loading={busy} icon={<CalendarDays size={18} aria-hidden />}>
                Создать ссылку на календарь
              </Button>
            </div>
          )}
          {token && (
            <>
              <div className={s.urlRow}>
                <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка на календарь" />
                <Button variant="secondary" onClick={copy} icon={copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}>
                  {copied ? 'Скопировано' : 'Скопировать'}
                </Button>
              </div>
              <p className={s.channelHint}>Ссылка секретная: она открывает ваши задачи без пароля. Никому её не присылайте.</p>
              <ol className={s.steps}>
                <li>
                  <b>Google Календарь</b> (на компьютере): слева у «Другие календари» нажмите «+», выберите «Добавить по URL» и вставьте ссылку.
                  Google обновляет такие календари раз в несколько часов, поэтому новые задачи появляются не сразу.
                </li>
                <li>
                  <b>iPhone и Mac (iCloud)</b>: нажмите «Подписаться в Календаре Apple» ниже или в настройках календаря добавьте «календарь подписки»
                  и вставьте ссылку.
                </li>
              </ol>
              <p className={s.channelHint}>
                Календарь сам заходит на этот адрес, поэтому сайт должен открываться из интернета. Из закрытой сети подписка не заработает.
              </p>
              <div className={s.actions}>
                <Button variant="secondary" onClick={() => (window.location.href = webcal)}>
                  Подписаться в Календаре Apple
                </Button>
                <Button variant="secondary" onClick={() => create(true)} loading={busy}>
                  Заменить ссылку
                </Button>
                <Button variant="ghost" onClick={disable} loading={busy}>
                  Отключить
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
