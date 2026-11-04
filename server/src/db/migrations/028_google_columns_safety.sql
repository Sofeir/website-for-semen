-- Страховка для баз, где миграция 027 применялась до последних правок (демо в браузере): добавляем недостающее, если его нет.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_verify_code text;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_calendar_unique ON users (lower(google_calendar_id)) WHERE google_calendar_id IS NOT NULL;
