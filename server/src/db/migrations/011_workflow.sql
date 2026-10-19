-- Цепочка заявки: филиал и сотрудник организации, отметка «техника возвращена», итог без ремонта,
-- повторное открытие по гарантии, уведомление о просрочке задачи.
ALTER TABLE orders ADD COLUMN branch text;
ALTER TABLE orders ADD COLUMN requester_name text;
ALTER TABLE orders ADD COLUMN device_returned_at timestamptz;
ALTER TABLE orders ADD COLUMN outcome text CHECK (outcome IN ('repaired', 'declined'));
ALTER TABLE orders ADD COLUMN reopen_count int NOT NULL DEFAULT 0;
UPDATE orders SET device_returned_at = issued_at WHERE issued_at IS NOT NULL;

ALTER TABLE order_history DROP CONSTRAINT order_history_kind_check;
ALTER TABLE order_history ADD CONSTRAINT order_history_kind_check CHECK (kind IN ('stage', 'transfer', 'reopen'));

ALTER TABLE tasks ADD COLUMN overdue_notified_at timestamptz;
