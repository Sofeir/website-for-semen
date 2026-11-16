-- Итог исполнителя при закрытии задачи хранится в его шаге цепочки и не пропадает, когда задачу возвращают в работу.
ALTER TABLE task_steps ADD COLUMN result_comment text;
