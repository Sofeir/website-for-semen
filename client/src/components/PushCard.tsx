import { useEffect, useState } from 'react';
import { BellRing, Volume2 } from 'lucide-react';
import { ApiError } from '@/api/http';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { playNotifySound, setSoundEnabled, soundEnabled } from '@/lib/sound';
import { Button } from '@/ui/Button';
import { Card, CardHead, Pill } from '@/ui/Display';
import { Checkbox } from '@/ui/Form';
import { useToast } from '@/ui/Toast';

const HINTS: Record<PushState, string> = {
  unsupported: 'Этот браузер или адрес не поддерживает системные уведомления. Они работают на сайте по https в Chrome, Edge, Safari и Firefox.',
  install:
    'На iPhone уведомления работают, когда сайт добавлен на экран «Домой»: в Safari нажмите «Поделиться», затем «На экран “Домой”», откройте сайт с иконки и вернитесь сюда.',
  denied: 'Уведомления запрещены в настройках браузера или телефона для этого сайта. Разрешите их там и обновите страницу.',
  off: 'Окно с уведомлением появится на экране телефона или компьютера, даже если сайт закрыт. Число на иконке покажет, сколько непрочитанных.',
  on: 'Это устройство получает системные уведомления. Если нужно, включите их на каждом своём устройстве отдельно.',
};

/** Системные уведомления на этом устройстве (Web Push) и звук в открытом сервисе. */
export function PushCard() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(soundEnabled());

  useEffect(() => {
    let off = false;
    pushState()
      .then((s) => !off && setState(s))
      .catch(() => !off && setState('unsupported'));
    return () => {
      off = true;
    };
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      const next = state === 'on' ? await disablePush() : await enablePush();
      setState(next);
      if (next === 'on') toast.success('Уведомления включены');
      if (next === 'denied') toast.error('Разрешение не выдано', 'Разрешите уведомления для сайта в настройках');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="Уведомления на этом устройстве" />
      <div className="stack">
        <div className="row wrap">
          <BellRing aria-hidden size={20} />
          {state === 'on' && <Pill tone="teal">включены</Pill>}
          {state === 'off' && <Pill tone="neutral">выключены</Pill>}
          {state === 'denied' && <Pill tone="neutral">запрещены</Pill>}
        </div>
        <p className="muted">{state ? HINTS[state] : 'Проверяем…'}</p>
        {(state === 'on' || state === 'off') && (
          <div className="row wrap">
            <Button variant={state === 'on' ? 'secondary' : 'primary'} size="sm" loading={busy} onClick={toggle}>
              {state === 'on' ? 'Выключить' : 'Включить уведомления'}
            </Button>
          </div>
        )}
        <div className="row wrap">
          <Volume2 aria-hidden size={20} />
          <Checkbox
            label="Звук, когда сайт открыт"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              setSoundEnabled(e.target.checked);
              if (e.target.checked) playNotifySound(true);
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => playNotifySound(true)}>
            Послушать
          </Button>
        </div>
      </div>
    </Card>
  );
}
