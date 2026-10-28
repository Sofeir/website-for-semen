import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, KeyRound, Save, Send } from 'lucide-react';
import { can, changePasswordSchema, profileSchema, ROLE_LABELS, type MaxLink, type Me, type ProfileInput } from '@sd/shared';
import { z } from 'zod';
import { useAuth, useMe } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { keys } from '@/api/queries';
import { useDocumentTitle } from '@/lib/hooks';
import { Button } from '@/ui/Button';
import { Avatar, Card, CardHead, ErrorBox, PageHeader, Pill } from '@/ui/Display';
import { Checkbox, Field, Input, formStyles } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import s from './ProfilePage.module.css';

export default function ProfilePage() {
  useDocumentTitle('Профиль');
  const me = useMe();
  return (
    <>
      <PageHeader title="Профиль" />
      <div className={s.head}>
        <Avatar name={me.fullName} size={56} />
        <div>
          <b className={s.name}>{me.fullName}</b>
          <p className="muted">
            {ROLE_LABELS[me.role]}, логин {me.login}
          </p>
        </div>
      </div>
      <div className={s.grid}>
        <Channels me={me} />
        <PasswordCard />
      </div>
    </>
  );
}

function Channels({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema) as any });
  const [testing, setTesting] = useState<string | null>(null);
  const { refresh } = useAuth();
  const [maxLink, setMaxLink] = useState<MaxLink | null>(null);
  const [linking, setLinking] = useState(false);

  const startMaxLink = async () => {
    setLinking(true);
    try {
      setMaxLink(await api.post<MaxLink>('/auth/me/max-link'));
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    } finally {
      setLinking(false);
    }
  };

  // пока человек подключается в Max, раз в 3 секунды смотрим, использован ли код
  useEffect(() => {
    if (!maxLink) return;
    const timer = setInterval(async () => {
      try {
        const { pending } = await api.get<{ pending: boolean }>('/auth/me/max-link');
        if (pending && new Date(maxLink.expiresAt).getTime() > Date.now()) return;
        setMaxLink(null);
        await refresh();
        if (!pending) toast.success('Max подключён', 'Уведомления будут приходить в Max');
        else toast.error('Код устарел', 'Нажмите «Подключить Max» ещё раз');
      } catch {
        /* связь пропала на секунду: попробуем при следующем опросе */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [maxLink, refresh, toast]);

  useEffect(() => {
    form.reset({
      notifyInApp: me.notifyInApp,
      notifyTelegram: me.notifyTelegram,
      notifyMax: me.notifyMax,
      telegramChatId: me.telegramChatId ?? '',
      maxUserId: me.maxUserId ?? '',
    });
  }, [me, form]);
  const v = form.watch();

  const submit = form.handleSubmit(async (values) => {
    try {
      const updated = await api.put<Me>('/auth/me/profile', values as any);
      qc.setQueryData(keys.me, (old: any) => (old ? { ...old, user: updated } : old));
      toast.success('Настройки уведомлений сохранены');
    } catch (e) {
      toast.error('Не сохранилось', (e as ApiError).message);
    }
  });

  const test = async (channel: 'telegram' | 'max') => {
    setTesting(channel);
    try {
      await api.post(`/auth/me/test-channel/${channel}`);
      toast.success('Тестовое сообщение отправлено');
    } catch (e) {
      toast.error('Не дошло', (e as ApiError).message);
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card>
      <CardHead title="Куда присылать уведомления" />
      <form className="stack" onSubmit={submit} noValidate>
        <div className={s.channel}>
          <Bell aria-hidden className={s.channelIcon} />
          <div className={s.channelMain}>
            <Checkbox label="Всплывающие сообщения в сервисе" {...form.register('notifyInApp')} />
            <p className={s.channelHint}>Колокольчик и лента работают всегда, даже если всплывающие выключены.</p>
          </div>
        </div>

        {(me.channels.telegram || can(me.role, 'users.manage')) && (
          <div className={s.channel}>
            <Send aria-hidden className={s.channelIcon} />
            <div className={s.channelMain}>
              <div className="row wrap">
                <Checkbox label="Telegram" {...form.register('notifyTelegram')} disabled={!me.channels.telegram} />
                {!me.channels.telegram && <Pill tone="neutral">не подключён</Pill>}
              </div>
              {me.channels.telegram ? (
                <>
                  <Field label="Ваш chat id" optional hint="Напишите боту сервиса /start, затем узнайте id у @userinfobot.">
                    <Input {...form.register('telegramChatId')} inputMode="numeric" disabled={!v.notifyTelegram} />
                  </Field>
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testing === 'telegram'}
                      disabled={!me.telegramChatId}
                      onClick={() => test('telegram')}
                    >
                      Проверить
                    </Button>
                  </div>
                </>
              ) : (
                <p className={s.channelHint}>
                  Канал не подключён. Чтобы включить, создайте бота в Telegram через @BotFather и впишите его токен в настройки
                  сервера (TELEGRAM_BOT_TOKEN). После этого каждый сотрудник сможет получать уведомления в Telegram.
                </p>
              )}
            </div>
          </div>
        )}

        {(me.channels.max || can(me.role, 'users.manage')) && (
          <div className={s.channel}>
            <Send aria-hidden className={s.channelIcon} />
            <div className={s.channelMain}>
              <div className="row wrap">
                <Checkbox label="Max" {...form.register('notifyMax')} disabled={!me.channels.max} />
                {!me.channels.max && <Pill tone="neutral">не подключён</Pill>}
              </div>
              {me.channels.max ? (
                <>
                  <div className="row wrap">
                    <Button variant="secondary" size="sm" loading={linking} onClick={startMaxLink}>
                      {me.maxUserId ? 'Подключить заново' : 'Подключить Max'}
                    </Button>
                    {me.maxUserId && <Pill tone="teal">подключён</Pill>}
                  </div>
                  {maxLink && (
                    <div className={s.maxLink}>
                      <p>
                        {maxLink.link ? (
                          <>
                            Откройте бота и нажмите «Начать»:{' '}
                            <a href={maxLink.link} target="_blank" rel="noreferrer">
                              открыть бота в Max
                            </a>
                            .
                          </>
                        ) : (
                          'Откройте бота сервиса в Max и отправьте ему этот код:'
                        )}
                      </p>
                      <p>
                        Если бот попросит код, отправьте ему <b className={s.maxCode}>{maxLink.code}</b>. Код действует 15 минут.
                      </p>
                      <p className={s.channelHint}>Эта страница сама заметит подключение.</p>
                    </div>
                  )}
                  <Field label="Ваш user id в Max" optional hint="Заполняется само при подключении. Вручную: напишите боту любое слово, он назовёт id.">
                    <Input {...form.register('maxUserId')} inputMode="numeric" disabled={!v.notifyMax} />
                  </Field>
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testing === 'max'}
                      disabled={!me.maxUserId}
                      onClick={() => test('max')}
                    >
                      Проверить
                    </Button>
                  </div>
                </>
              ) : (
                <p className={s.channelHint}>
                  Канал не подключён. Чтобы включить, создайте бота в Max и впишите его токен в настройки сервера (MAX_BOT_TOKEN).
                  После этого каждый сотрудник сможет получать уведомления в Max.
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <Button type="submit" icon={<Save size={18} aria-hidden />} loading={form.formState.isSubmitting}>
            Сохранить
          </Button>
        </div>
      </form>
    </Card>
  );
}

const passwordForm = changePasswordSchema.extend({ repeat: z.string() }).refine((v) => v.next === v.repeat, {
  path: ['repeat'],
  message: 'Пароли не совпадают',
});

function PasswordCard() {
  const toast = useToast();
  const form = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm) as any });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async ({ current, next }) => {
    try {
      await api.post('/auth/me/password', { current, next });
      toast.success('Пароль изменён', 'На других устройствах нужно войти заново');
      form.reset({ current: '', next: '', repeat: '' });
    } catch (err) {
      const ae = err as ApiError;
      Object.entries(ae.fields ?? {}).forEach(([k, m]) => form.setError(k as any, { message: m }));
      if (!ae.fields?.current) form.setError('root', { message: ae.message });
    }
  });
  return (
    <Card>
      <CardHead title="Пароль" />
      <form className="stack" onSubmit={submit} noValidate>
        {e.root?.message && <ErrorBox>{e.root.message}</ErrorBox>}
        <Field label="Текущий пароль" error={e.current?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('current')} />
        </Field>
        <div className={formStyles.grid2}>
          <Field label="Новый пароль" error={e.next?.message} hint="От 8 символов">
            <Input type="password" autoComplete="new-password" {...form.register('next')} />
          </Field>
          <Field label="Ещё раз" error={e.repeat?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('repeat')} />
          </Field>
        </div>
        <div>
          <Button
            type="submit"
            variant="secondary"
            icon={<KeyRound size={18} aria-hidden />}
            loading={form.formState.isSubmitting}
          >
            Сменить пароль
          </Button>
        </div>
      </form>
    </Card>
  );
}
