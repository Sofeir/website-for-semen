-- Возврат заявки на этап назад: в истории появляется отдельный вид записи «back» (причина лежит в комментарии).
ALTER TABLE order_history DROP CONSTRAINT order_history_kind_check;
ALTER TABLE order_history ADD CONSTRAINT order_history_kind_check CHECK (kind IN ('stage', 'transfer', 'reopen', 'back'));
