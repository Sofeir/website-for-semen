import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, RefreshCw, Unplug } from 'lucide-react';
import type { GoogleCalendarStatus } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Card, CardHead, ErrorBox, Spinner } from '@/ui/Display';
import { Field, Input } from '@/ui/Form';
import { useToast } from '@/ui/Toast';

/**
 * Запись задач и событий прямо в ваш Google Календарь: сразу, без ожидания, пока Google обновит подписку.
 * Основной способ — кнопка «Подключить»: выбираете свою почту и разрешаете доступ, больше ничего вводить не нужно.
 * Запасной способ (сервисный аккаунт) показывается только там, где вход через Google на сервере не включён.
 */
export function GoogleCalendarCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['googleCalendar'], queryFn: () => api.get<GoogleCalendarStatus>('/me/google-calendar') });
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Возврат из Google: адрес профиля с пометкой, чем закончилось подключение
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('google');
    if (!result) return;
    url.searchParams.delete('google');
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    qc.invalidateQueries({ queryKey: ['googleCalendar'] });
    if (result === 'connected') toast.success('Google Календарь подключён', 'Задачи и события уже записываются в ваш календарь');
    else if (result === 'cancelled') toast.error('Подключение отменено', 'Вы не разрешили доступ. Можно попробовать ещё раз');
    else if (result === 'expired') toast.error('Ссылка подключения устарела', 'Нажмите «Подключить» ещё раз');
    else toast.error('Не получилось подключить', 'Попробуйте ещё раз или сообщите администратору');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<GoogleCalendarStatus>, done?: string) => {
    setBusy(true);
    setError('');
    try {
      qc.setQueryData(['googleCalendar'], await fn());
      if (done) toast.success(done);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ url: string }>('/me/google-calendar/connect');
      window.location.href = r.url;
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  };

  const st = q.data;
  const connectedBlock = (label: string) => (
    <>
      <p>
        Задачи и ваши события записываются в календарь <b>{label}</b>, сразу после любого изменения.{' '}
        {st?.syncedAt ? `Последнее обновление: ${fmtWhen(st.syncedAt)}.` : 'Первое обновление скоро.'}
      </p>
      {st?.error && <ErrorBox>{st.error}</ErrorBox>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={16} aria-hidden />}
          loading={busy}
          onClick={() => run(() => api.post<GoogleCalendarStatus>('/me/google-calendar/sync'), 'Календарь обновлён')}
        >
          Обновить сейчас
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Unplug size={16} aria-hidden />}
          disabled={busy}
          onClick={() => run(() => api.del<GoogleCalendarStatus>('/me/google-calendar'), 'Календарь отключён, записи сервиса из него убраны')}
        >
          Отключить
        </Button>
      </div>
    </>
  );

  return (
    <Card>
      <CardHead title="Google Календарь" />
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorBox error={q.error} />
        ) : st?.oauthConnected ? (
          <>
            {connectedBlock(st.connectedEmail ?? 'Google')}
            {st.error && /подключите|заново/i.test(st.error) && (
              <Button icon={<CalendarCheck size={18} aria-hidden />} loading={busy} onClick={connect}>
                Подключить заново
              </Button>
            )}
          </>
        ) : st?.oauthConfigured ? (
          <>
            <p>
              Задачи и ваши события будут сразу появляться в вашем Google Календаре. Нажмите кнопку, выберите свою почту Google и разрешите
              доступ: больше ничего вводить не нужно.
            </p>
            {st.error && <ErrorBox>{st.error}</ErrorBox>}
            <div>
              <Button icon={<CalendarCheck size={18} aria-hidden />} loading={busy} onClick={connect}>
                Подключить Google Календарь
              </Button>
            </div>
            <p className="muted">
              Если Google напишет «Приложение не проверено», нажмите «Дополнительные» и «Перейти на сайт»: это наш сервис, он просит доступ только к событиям
              вашего календаря.
            </p>
          </>
        ) : !st?.configured ? (
          <p className="muted">Запись в Google Календарь пока не включена на сервере. Её включает администратор: ему нужно добавить ключи приложения Google.</p>
        ) : st.calendarId ? (
          connectedBlock(st.calendarId)
        ) : (
          <>
            <ol className="muted" style={{ margin: 0, paddingLeft: '1.2em' }}>
              <li>В Google Календаре создайте свой календарь (или возьмите существующий) и откройте его настройки.</li>
              <li>
                В разделе «Доступ для отдельных пользователей» добавьте адрес <b>{st.serviceEmail}</b> с правом «Вносить изменения в мероприятия».
              </li>
              <li>
                В настройках календаря в поле «Описание» вставьте код <b>{st.verifyCode}</b>. Так мы убеждаемся, что календарь ваш. После подключения код можно убрать.
              </li>
              <li>В разделе «Интеграция календаря» скопируйте «Идентификатор календаря» и вставьте сюда.</li>
            </ol>
            <Field label="Идентификатор календаря">
              <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="name@gmail.com" autoComplete="off" spellCheck={false} />
            </Field>
            <div>
              <Button
                loading={busy}
                onClick={() => run(() => api.put<GoogleCalendarStatus>('/me/google-calendar', { calendarId: id }), 'Календарь подключён')}
              >
                Подключить
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
