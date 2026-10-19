-- Роль сотрудника подтверждена владельцем или пока предположение (тогда в «Сотрудниках» стоит пометка «роль не уточнена»).
ALTER TABLE users ADD COLUMN role_confirmed boolean NOT NULL DEFAULT true;
-- Демо-сотрудники, чьи роли взяты из примеров в ТЗ, а не подтверждены.
UPDATE users SET role_confirmed = false WHERE login IN ('stas', 'olga', 'lenya');
