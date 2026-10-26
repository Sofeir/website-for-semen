-- Выезд проверяет технику клиента по одной единице: проверка привязывается к задаче-выезду.
ALTER TABLE device_inspections ADD COLUMN task_id int REFERENCES tasks ON DELETE SET NULL;
CREATE INDEX device_inspections_task ON device_inspections (task_id);
-- Единый список пунктов выезда больше не нужен: у каждого компьютера и принтера свой бланк (справочники ПК и МФУ)
DELETE FROM checklist_items WHERE kind = 'visit';
-- Название организации в документах: Асофт
UPDATE settings SET value = jsonb_set(value, '{name}', '"Асофт"') WHERE key = 'company' AND value ->> 'name' = 'Северный Мост';
