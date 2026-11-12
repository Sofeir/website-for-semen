-- Вход через Google: сотрудник один раз нажимает «Подключить» и разрешает доступ, дальше сервис сам пишет в его календарь.
-- Токен лежит только зашифрованным (см. services/googleCalendar.ts), google_email нужен, чтобы показать, какая почта подключена.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email text;
-- Одноразовая метка подключения: связывает возврат из Google с сотрудником, не полагаясь на cookie при переходе с чужого сайта
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_oauth_state text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_oauth_state_at timestamptz;
