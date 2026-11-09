import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import s from './PushPrompt.module.css';

const KEY = 'sd-push-prompt-later';
const LATER_MS = 24 * 3600_000;

const later = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < LATER_MS;
  } catch {
    return false;
  }
};

/**
 * Предложение включить уведомления на этом устройстве. Браузеры и iPhone не позволяют включить их без нажатия человека,
 * поэтому после входа показываем одну кнопку: нажали один раз, и дальше уведомления приходят всегда (повторно спрашивать не нужно).
 */
export function PushPrompt() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(later());

  useEffect(() => {
    let off = false;
    pushState()
      .then((v) => !off && setState(v))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  // Показываем, если можно включить (off) или на iPhone надо сначала поставить сайт на экран «Домой» (install)
  if (hidden || (state !== 'off' && state !== 'install')) return null;

  const later_ = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // без памяти браузера подсказка вернётся при следующем входе
    }
    setHidden(true);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'on') toast.success('Уведомления включены', 'Теперь они приходят на это устройство, даже когда сайт закрыт');
      else if (next === 'denied') toast.error('Разрешение не выдано', 'Разрешите уведомления для сайта в настройках браузера');
    } catch (e) {
      toast.error('Не получилось', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.bar} role="region" aria-label="Уведомления на устройстве">
      <BellRing aria-hidden className={s.icon} />
      <p className={s.text}>
        {state === 'install'
          ? 'Чтобы уведомления приходили на iPhone, добавьте сайт на экран «Домой»: «Поделиться» → «На экран “Домой”», затем откройте его с иконки.'
          : 'Включите уведомления, чтобы не пропускать задачи и заявки, даже когда сайт закрыт.'}
      </p>
      <div className={s.actions}>
        {state === 'off' && (
          <Button size="sm" loading={busy} onClick={enable}>
            Включить
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={later_}>
          Позже
        </Button>
      </div>
    </div>
  );
}
