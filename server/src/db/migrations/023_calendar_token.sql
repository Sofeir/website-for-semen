-- Секретная ссылка на календарь задач (подписка из Google Календаря, iCloud и т. п.). Пусто — лента отключена.
ALTER TABLE users ADD COLUMN calendar_token text UNIQUE;
