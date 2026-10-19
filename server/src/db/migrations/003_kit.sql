-- Комплектность: «без кабеля питания» отдельным пунктом (как «без ЗУ»), SIM больше не отмечаем.
INSERT INTO checklist_items (kind, name, sort)
SELECT 'kit', 'Без кабеля питания', coalesce((SELECT sort FROM checklist_items WHERE kind = 'kit' AND name = 'С ЗУ'), 20) + 1
WHERE NOT EXISTS (SELECT 1 FROM checklist_items WHERE kind = 'kit' AND name = 'Без кабеля питания')
  -- на пустой базе справочник заполнит seed, здесь не мешаем
  AND EXISTS (SELECT 1 FROM checklist_items WHERE kind = 'kit');

UPDATE checklist_items SET is_active = false WHERE kind = 'kit' AND name = 'SIM или карта памяти';
