-- Стандартный чек-лист выезда: подставляется, когда у клиента нет своего списка работ.
ALTER TABLE checklist_items DROP CONSTRAINT checklist_items_kind_check;
ALTER TABLE checklist_items
  ADD CONSTRAINT checklist_items_kind_check CHECK (kind IN ('appearance', 'kit', 'inspect_pc', 'inspect_printer', 'visit'));

INSERT INTO checklist_items (kind, name, sort) VALUES
  ('visit', 'Проверить компьютеры по чек-листу', 10),
  ('visit', 'Проверить принтеры и МФУ по чек-листу', 20),
  ('visit', 'Записать замены и выполненные работы в журнал техники', 30);
