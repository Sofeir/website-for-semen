-- Как проведено обслуживание клиента: выездом или удалённо. Имеет смысл только у задач-выездов (is_visit).
ALTER TABLE tasks ADD COLUMN visit_mode text NOT NULL DEFAULT 'onsite' CHECK (visit_mode IN ('onsite', 'remote'));
