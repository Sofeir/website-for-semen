-- Решение со встречи: «Без ЗУ и кабеля питания» — одна кнопка, SIM не берём, «Карта памяти» остаётся.
-- В уже принятой технике комплектность хранится текстом, так что старые записи не меняются.
UPDATE checklist_items SET name = 'Без ЗУ и кабеля питания', is_active = true
 WHERE kind = 'kit' AND name = 'Без ЗУ'
   AND NOT EXISTS (SELECT 1 FROM checklist_items WHERE kind = 'kit' AND name = 'Без ЗУ и кабеля питания');
UPDATE checklist_items SET is_active = false WHERE kind = 'kit' AND name IN ('Без кабеля питания', 'SIM или карта памяти');
INSERT INTO checklist_items (kind, name, sort)
SELECT 'kit', 'Карта памяти', coalesce((SELECT max(sort) FROM checklist_items WHERE kind = 'kit'), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM checklist_items WHERE kind = 'kit' AND name = 'Карта памяти')
  -- на пустой базе справочник заполнит seed
  AND EXISTS (SELECT 1 FROM checklist_items WHERE kind = 'kit');
UPDATE checklist_items SET is_active = true WHERE kind = 'kit' AND name = 'Карта памяти';
