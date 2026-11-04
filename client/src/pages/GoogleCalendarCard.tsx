import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Unplug } from 'lucide-react';
import type { GoogleCalendarStatus } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { fmtWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Card, CardHead, ErrorBox, Spinner } from '@/ui/Display';
import { Field, Input } from '@/ui/Form';
import { useToast } from '@/ui/Toast';

/**
 * Запись задач и событий прямо в ваш Google Календарь: без ожидания, пока Google обновит подписку.
 * Вы делитесь своим календарём с адресом сервиса, а здесь указываете ID календаря.
 */
export function GoogleCalendarCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['googleCalendar'], queryFn: () => api.get<GoogleCalendarStatus>('/me/google-calendar') });
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const st = q.data;
  return (
    <Card>
      <CardHead title="Google Календарь" />
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorBox error={q.error} />
        ) : !st?.configured ? (
          <p className="muted">Запись в Google Календарь пока не включена на сервере. Её включает администратор: ему нужно добавить ключ сервисного аккаунта Google.</p>
        ) : st.calendarId ? (
          <>
            <p>
              Задачи и ваши события записываются в календарь <b>{st.calendarId}</b>.{' '}
              {st.syncedAt ? `Последнее обновление: ${fmtWhen(st.syncedAt)}.` : 'Первое обновление скоро.'}
            </p>
            {st.error && <ErrorBox>{st.error}</ErrorBox>}
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
