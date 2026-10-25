import { useEffect, useState } from 'react';
import { useConfirm } from '@/ui/Confirm';
import s from './LoginPage.module.css';

const ACCOUNTS = [
  { login: 'semen', label: 'Директор', who: 'Вайнштейн' },
  { login: 'admin', label: 'Рук. сисадмин', who: 'Голенков' },
  { login: 'stas', label: 'Ведущий инженер', who: 'Исаков' },
  { login: 'lenya', label: 'Инженер', who: 'Катаев' },
  { login: 'maria', label: 'Заказчик', who: 'Мария' },
];

/** Подсказка на экране входа демо-версии: чьим сотрудником войти и как стереть данные. */
export function DemoPanel({ onPick }: { onPick: (login: string, password: string) => void }) {
  const [ready, setReady] = useState(false);
  const [exportNote, setExportNote] = useState('');
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
            setExportNote('Собираем файл…');
            try {
              const { downloadSqlExport } = await import('@/demo/exportData');
              const counts = await downloadSqlExport();
              const rows = Object.values(counts).reduce((a, b) => a + b, 0);
              setExportNote(`Файл скачан. В нём ${rows} записей в ${Object.keys(counts).length} таблицах.`);
            } catch (e) {
              setExportNote(`Не получилось: ${(e as Error).message}`);
            }
          }}
        >
          Скачать все данные для переноса на сервер
        </button>
      )}
      {exportNote && <p className={s.demoWait}>{exportNote}</p>}
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
