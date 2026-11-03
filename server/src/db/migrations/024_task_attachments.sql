-- Файлы и фото к задачам: вложение привязывается к задаче так же, как к заявке или клиенту.
ALTER TABLE attachments ADD COLUMN task_id int REFERENCES tasks ON DELETE CASCADE;
CREATE INDEX attachments_task ON attachments (task_id);
