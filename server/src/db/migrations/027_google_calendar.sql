-- Синхронизация с Google Календарём: сервис сам записывает задачи и события в календарь сотрудника.
-- Сотрудник делится своим календарём с сервисным аккаунтом и указывает ID календаря в профиле.
ALTER TABLE users ADD COLUMN google_calendar_id text;
ALTER TABLE users ADD COLUMN google_sync_at timestamptz;
ALTER TABLE users ADD COLUMN google_sync_error text;

-- Какое событие в Google соответствует какой задаче или событию. fingerprint — что отправлено в прошлый раз:
-- если не изменилось, в Google не ходим.
CREATE TABLE google_events (
  kind text NOT NULL CHECK (kind IN ('task', 'event')),
  ref_id int NOT NULL,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  google_id text NOT NULL,
  fingerprint text NOT NULL,
  PRIMARY KEY (kind, ref_id, user_id)
);
