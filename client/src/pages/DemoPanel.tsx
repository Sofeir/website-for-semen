import { useEffect, useState } from 'react';
import { useConfirm } from '@/ui/Confirm';
import s from './LoginPage.module.css';

const ACCOUNTS = [
  { login: 'semen', label: 'Руководитель', who: 'Семён' },
  { login: 'stas', label: 'Диагност', who: 'Стас' },
  { login: 'lenya', label: 'Мастер', who: 'Лёня' },
  { login: 'admin', label: 'Администратор', who: 'admin' },
  { login: 'maria', label: 'Заказчик', who: 'Мария' },
];

/** Подсказка на экране входа демо-версии: чьим сотрудником войти и как стереть данные. */
export function DemoPanel({ onPick }: { onPick: (login: string, password: string) => void }) {
  const [ready, setReady] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    let alive = true;
    import('@/demo/runtime').then(({ bootDemo }) => bootDemo().then(() => alive && setReady(true)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={s.demo}>
      <p className={s.demoTitle}>Демо-версия</p>
      <p className={s.demoText}>
        Сервис работает прямо в вашем браузере. Данные учебные и хранятся только на этом устройстве. Пароль для всех: <b>demo</b>.
      </p>
      <div className={s.demoChips} role="group" aria-label="Войти как">
        {ACCOUNTS.map((a) => (
          <button key={a.login} type="button" className={s.demoChip} onClick={() => onPick(a.login, 'demo')}>
            <b>{a.label}</b>
            <span>{a.who}</span>
          </button>
        ))}
      </div>
      {!ready && <p className={s.demoWait}>Готовим демо-базу. При первом открытии это занимает около 20 секунд.</p>}
      {ready && (
        <button
          type="button"
          className={s.demoReset}
          onClick={async () => {
            const ok = await confirm({
              title: 'Стереть все изменения?',
              body: 'Вернутся исходные демо-данные. Всё, что вы добавили, пропадёт.',
              confirm: 'Стереть',
              danger: true,
            });
            if (ok) import('@/demo/runtime').then(({ resetDemo }) => resetDemo());
          }}
        >
          Сбросить демо-данные
        </button>
      )}
    </div>
  );
}
