import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useMe } from '@/app/auth';
import { api } from '@/api/http';
import { keys } from '@/api/queries';
import { staffFirstName } from '@/lib/names';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import s from './Onboarding.module.css';

interface Step {
  title: string;
  text: string;
}

function stepsFor(canIntake: boolean, manager: boolean, workspace: boolean): Step[] {
  const steps: Step[] = [];
  if (canIntake) {
    steps.push({
      title: 'Приём — одна форма',
      text: 'Кнопка «Принять технику». Найдите клиента по телефону или создайте нового прямо в форме, отметьте внешний вид и комплектность чипами. После сохранения квитанция PDF и задача «Диагностика» появятся сами.',
    });
  }
  if (workspace) {
    steps.push({
      title: 'Заявка идёт по этапам',
      text: 'Приём, диагностика, согласование, ремонт, готово, выдача. Перескочить этап нельзя: заявку двигает дальше ответственный или руководитель. Технику можно передать коллеге, например мастеру.',
    });
  }
  steps.push(
    {
      title: 'Задачи и уведомления',
      text: 'Колокольчик сверху показывает новые задачи и передачи. Отметьте несколько задач галочками и закройте разом. В профиле можно включить Telegram или Max.',
    },
    {
      title: 'Календарь собирается сам',
      text: manager
        ? 'Календарь строится из сроков задач, вручную заполнять не нужно. На главной видно просрочки всех сотрудников.'
        : 'Календарь строится из сроков ваших задач. На главной — что нужно сделать сегодня и что уже просрочено.',
    },
  );
  return steps;
}

export function Onboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const { can } = useAuth();
  const qc = useQueryClient();
  const steps = stepsFor(can('intake.create'), can('tasks.manageAll'), can('workspace.view'));
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;

  const finish = async () => {
    onClose();
    setI(0);
    if (!me.onboarded) {
      await api.post('/auth/me/onboarded').catch(() => {});
      qc.setQueryData(keys.me, (old: any) => (old ? { ...old, user: { ...old.user, onboarded: true } } : old));
    }
  };

  return (
    <Sheet
      open={open}
      onClose={finish}
      title={i === 0 && !me.onboarded ? `Привет, ${staffFirstName(me.fullName)}!` : 'Как здесь всё устроено'}
      subtitle="Четыре коротких подсказки. Открыть их снова можно в меню профиля."
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={finish}>
            Пропустить
          </Button>
          <Button onClick={() => (last ? finish() : setI(i + 1))} data-autofocus>
            {last ? 'Понятно, начинаем' : 'Дальше'}
          </Button>
        </>
      }
    >
      <ol className={s.dots} aria-label="Шаги">
        {steps.map((st, idx) => (
          <li key={st.title}>
            <button
              type="button"
              className={s.dot}
              aria-current={idx === i ? 'step' : undefined}
              aria-label={`Шаг ${idx + 1}: ${st.title}`}
              onClick={() => setI(idx)}
            >
              {String(idx + 1).padStart(2, '0')}
            </button>
          </li>
        ))}
      </ol>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={i}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18 }}
          className={s.step}
        >
          <h3 className={s.title}>{steps[i]?.title}</h3>
          <p className={s.text}>{steps[i]?.text}</p>
        </motion.div>
      </AnimatePresence>
    </Sheet>
  );
}
