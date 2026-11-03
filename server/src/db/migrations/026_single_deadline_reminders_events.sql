-- Срок и крайний срок слиты в один «крайний срок»: по нему считаются просрочка и напоминания (колонка tasks.due_at).
-- У задач, где крайний срок стоял позже срока, берём его: именно на него ориентировались сотрудники.
UPDATE tasks SET due_at = deadline_at WHERE deadline_at IS NOT NULL AND deadline_at > due_at;
UPDATE tasks SET deadline_at = NULL WHERE deadline_at IS NOT NULL;

-- Напоминания: с какого момента считать «за N минут до срока». Напоминания, время которых прошло до этого момента
-- (задачу поставили или передали уже внутри окна), не шлются.
ALTER TABLE tasks ADD COLUMN remind_from timestamptz NOT NULL DEFAULT now();

-- Свои напоминания сотрудника. Пока он ничего не настраивал (reminders_custom = false), действуют стандартные:
-- за сутки, за 2 часа и за 15 минут.
ALTER TABLE users ADD COLUMN reminders_custom boolean NOT NULL DEFAULT false;
CREATE TABLE user_reminders (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  minutes_before int NOT NULL CHECK (minutes_before BETWEEN 1 AND 43200),
  UNIQUE (user_id, minutes_before)
);

-- Что уже напомнено. for_at — срок, на который отправлено: если срок сменили, напоминания по нему отправляются заново.
CREATE TABLE reminders_sent (
  kind text NOT NULL CHECK (kind IN ('task', 'event')),
  ref_id int NOT NULL,
  user_id int NOT NULL,
  minutes_before int NOT NULL,
  for_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref_id, user_id, minutes_before)
);

-- Личные события календаря: только для себя, без исполнителей и без конца.
CREATE TABLE calendar_events (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  title text NOT NULL,
  note text,
  start_at timestamptz NOT NULL,
  remind_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_events_user_start ON calendar_events (user_id, start_at);
