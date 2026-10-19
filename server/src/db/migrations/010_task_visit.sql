-- Задача-выезд к клиенту: отдельный признак, чтобы собрать все выезды в разделе «Выезды».
ALTER TABLE tasks ADD COLUMN is_visit boolean NOT NULL DEFAULT false;
UPDATE tasks SET is_visit = true WHERE title LIKE 'Выезд:%';
CREATE INDEX tasks_visit ON tasks (due_at) WHERE is_visit;
