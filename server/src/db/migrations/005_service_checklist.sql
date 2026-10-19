-- Выезд к клиенту: у клиента — список работ на точке (шаблон), у задачи — чек-лист, который отмечает специалист.
CREATE TABLE service_checklist_items (
  id        serial PRIMARY KEY,
  client_id int NOT NULL REFERENCES clients ON DELETE CASCADE,
  title     text NOT NULL,
  sort      int NOT NULL DEFAULT 0
);
CREATE INDEX service_checklist_client ON service_checklist_items (client_id, sort);

CREATE TABLE task_checklist_items (
  id       serial PRIMARY KEY,
  task_id  int NOT NULL REFERENCES tasks ON DELETE CASCADE,
  title    text NOT NULL,
  sort     int NOT NULL DEFAULT 0,
  done     boolean NOT NULL DEFAULT false,
  done_at  timestamptz,
  done_by  int REFERENCES users ON DELETE SET NULL
);
CREATE INDEX task_checklist_task ON task_checklist_items (task_id, sort);
