-- Решение заказчика 19.10.2026: рабочий день до 19:00. Базы, созданные раньше, хранят 20:00 — меняем,
-- только если там всё ещё старое значение по умолчанию (своё время, выставленное в настройках, не трогаем).
UPDATE settings SET value = jsonb_set(value, '{workEnd}', '"19:00"')
 WHERE key = 'work' AND value->>'workEnd' = '20:00';
UPDATE settings SET value = jsonb_set(value, '{workHours}', '"Пн–Пт 10:00–19:00"')
 WHERE key = 'company' AND value->>'workHours' = 'Пн–Пт 10:00–20:00';
