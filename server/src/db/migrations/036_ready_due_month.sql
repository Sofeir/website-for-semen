-- Задача «Выдать» (этап «Готово») живёт месяц: срок открытых задач выдачи ставим на месяц от начала, если он был короче.
-- Без этого после смены правила все готовые заявки с короткими сроками разом стали бы просроченными.
UPDATE tasks t
   SET due_at = t.start_at + interval '1 month', was_overdue = false, overdue_notified_at = NULL, remind_from = now(), updated_at = now()
  FROM stages s
 WHERE s.id = t.stage_id AND s.code = 'ready' AND t.status = 'open' AND t.due_at < t.start_at + interval '1 month';

UPDATE orders o
   SET stage_due_at = (SELECT t.due_at FROM tasks t WHERE t.order_id = o.id AND t.stage_id = o.stage_id AND t.status = 'open' ORDER BY t.id DESC LIMIT 1)
  FROM stages s
 WHERE s.id = o.stage_id AND s.code = 'ready'
   AND EXISTS (SELECT 1 FROM tasks t WHERE t.order_id = o.id AND t.stage_id = o.stage_id AND t.status = 'open');
