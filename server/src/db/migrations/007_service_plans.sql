-- График регулярных выездов к клиенту: раз в N недель или месяцев.
-- Накануне выезда сервер сам ставит задачу «Выезд: …» с чек-листом работ клиента.
CREATE TABLE service_plans (
  id           serial PRIMARY KEY,
  client_id    int NOT NULL UNIQUE REFERENCES clients ON DELETE CASCADE,
  every_n      int NOT NULL CHECK (every_n BETWEEN 1 AND 52),
  unit         text NOT NULL CHECK (unit IN ('week', 'month')),
  next_date    date NOT NULL,
  visit_time   text,
  assignee_id  int NOT NULL REFERENCES users,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   int REFERENCES users ON DELETE SET NULL,
  last_task_id int REFERENCES tasks ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_plans_next ON service_plans (next_date) WHERE is_active;
