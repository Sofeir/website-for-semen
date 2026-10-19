-- Виды задач: техника, общие, выезды и любые другие, которые заводят прямо в календаре.
CREATE TABLE task_kinds (
  id        serial PRIMARY KEY,
  code      text UNIQUE,
  name      text NOT NULL UNIQUE,
  color     text NOT NULL DEFAULT 'blue',
  sort      int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO task_kinds (code, name, color, sort) VALUES
  ('device', 'Техника', 'teal', 10),
  ('general', 'Общие', 'slate', 20),
  ('visit', 'Выезды', 'amber', 30);

ALTER TABLE tasks ADD COLUMN kind_id int REFERENCES task_kinds ON DELETE SET NULL;
UPDATE tasks SET kind_id = (
  SELECT id FROM task_kinds WHERE code = CASE WHEN tasks.is_visit THEN 'visit' WHEN tasks.order_id IS NOT NULL THEN 'device' ELSE 'general' END
);
CREATE INDEX tasks_kind ON tasks (kind_id);
