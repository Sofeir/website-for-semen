-- Несколько ответственных у одной задачи. tasks.assignee_id остаётся «главным» ответственным (первый в списке),
-- а полный список лежит здесь. Так старые выборки, отчёты и кабинет заказчика продолжают работать.
CREATE TABLE task_assignees (
  task_id int NOT NULL REFERENCES tasks ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user ON task_assignees (user_id);

INSERT INTO task_assignees (task_id, user_id) SELECT id, assignee_id FROM tasks;

-- Главный ответственный всегда есть в списке, откуда бы задачу ни создали (сид, график выездов, заявки).
CREATE FUNCTION task_assignees_sync() RETURNS trigger AS $$
BEGIN
  INSERT INTO task_assignees (task_id, user_id) VALUES (NEW.id, NEW.assignee_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_assignees_sync AFTER INSERT OR UPDATE OF assignee_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION task_assignees_sync();

-- Напоминания о сроке: за сутки и за 2 часа, каждое отправляется один раз.
ALTER TABLE tasks ADD COLUMN remind_day_at timestamptz;
ALTER TABLE tasks ADD COLUMN remind_2h_at timestamptz;
