-- Кто подтверждает закрытие просроченных задач: сейчас только директор Вайнштейн. Остальным запрос не приходит и закрыть они не могут.
ALTER TABLE users ADD COLUMN confirms_overdue boolean NOT NULL DEFAULT false;
UPDATE users SET confirms_overdue = true WHERE role = 'manager' AND full_name ILIKE 'Вайнштейн%';

-- Задача, которую передали уже просроченной, остаётся просроченной: новый срок исполнителя её не «обнуляет».
ALTER TABLE tasks ADD COLUMN was_overdue boolean NOT NULL DEFAULT false;

-- Наблюдатели: видят задачу и получают уведомления, но не исполняют и не закрывают её.
CREATE TABLE task_watchers (
  task_id int NOT NULL REFERENCES tasks ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_watchers_user ON task_watchers (user_id);
