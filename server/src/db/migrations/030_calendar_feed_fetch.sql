-- Когда внешний календарь (Google, iCloud) последний раз забирал ленту и сколько задач в ней было: в профиле видно, дошла ли лента до календаря.
ALTER TABLE users ADD COLUMN calendar_fetched_at timestamptz;
ALTER TABLE users ADD COLUMN calendar_fetched_tasks integer;
