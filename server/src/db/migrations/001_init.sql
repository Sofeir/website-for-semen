-- Базовая схема сервис-центра.

CREATE TABLE users (
  id               serial PRIMARY KEY,
  login            text NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  full_name        text NOT NULL,
  role             text NOT NULL CHECK (role IN ('admin', 'manager', 'diagnostician', 'master')),
  phone            text,
  is_active        boolean NOT NULL DEFAULT true,
  onboarded_at     timestamptz,
  notify_inapp     boolean NOT NULL DEFAULT true,
  notify_telegram  boolean NOT NULL DEFAULT false,
  notify_max       boolean NOT NULL DEFAULT false,
  telegram_chat_id text,
  max_user_id      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           text PRIMARY KEY,             -- sha256 от токена из cookie
  user_id      int NOT NULL REFERENCES users ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  remember     boolean NOT NULL DEFAULT false,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- Этапы ремонта. Порядок задаёт sort; заявка двигается только на следующий активный этап.
CREATE TABLE stages (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  sort       int NOT NULL,
  color      text NOT NULL DEFAULT 'blue',
  sla_hours  int NOT NULL DEFAULT 24,
  is_final   boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE device_types (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  sort      int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE brands (
  id             serial PRIMARY KEY,
  device_type_id int NOT NULL REFERENCES device_types ON DELETE CASCADE,
  name           text NOT NULL,
  sort           int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (device_type_id, name)
);

CREATE TABLE models (
  id        serial PRIMARY KEY,
  brand_id  int NOT NULL REFERENCES brands ON DELETE CASCADE,
  name      text NOT NULL,
  sort      int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (brand_id, name)
);

-- device_type_id = NULL — неисправность подходит к любой технике.
CREATE TABLE faults (
  id             serial PRIMARY KEY,
  device_type_id int REFERENCES device_types ON DELETE CASCADE,
  name           text NOT NULL,
  sort           int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE checklist_items (
  id        serial PRIMARY KEY,
  kind      text NOT NULL CHECK (kind IN ('appearance', 'kit')),
  name      text NOT NULL,
  sort      int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (kind, name)
);

CREATE TABLE services (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  price          numeric(12, 2) NOT NULL DEFAULT 0,
  price_from     boolean NOT NULL DEFAULT false,
  device_type_id int REFERENCES device_types ON DELETE SET NULL,
  sort           int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE warranties (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  months     int NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  sort       int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE clients (
  id             serial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('person', 'legal')),
  name           text NOT NULL,
  phone          text,
  phone_digits   text,
  phone2         text,
  email          text,
  address        text,
  inn            text,
  kpp            text,
  contact_person text,
  note           text,
  created_by     int REFERENCES users ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_phone_digits ON clients (phone_digits);
CREATE INDEX clients_inn ON clients (inn);
CREATE INDEX clients_name ON clients (lower(name));

CREATE TABLE devices (
  id             serial PRIMARY KEY,
  client_id      int NOT NULL REFERENCES clients ON DELETE CASCADE,
  device_type_id int NOT NULL REFERENCES device_types,
  brand_id       int REFERENCES brands ON DELETE SET NULL,
  brand_text     text,
  model_id       int REFERENCES models ON DELETE SET NULL,
  model_text     text,
  serial         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_client ON devices (client_id);

-- Один приём = одна квитанция, в ней может быть несколько единиц техники (юрлица).
CREATE TABLE intake_batches (
  id         serial PRIMARY KEY,
  client_id  int NOT NULL REFERENCES clients ON DELETE CASCADE,
  comment    text,
  created_by int REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE order_number_seq START 1001;

CREATE TABLE orders (
  id               serial PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  batch_id         int REFERENCES intake_batches ON DELETE SET NULL,
  client_id        int NOT NULL REFERENCES clients ON DELETE CASCADE,
  device_id        int NOT NULL REFERENCES devices,
  stage_id         int NOT NULL REFERENCES stages,
  responsible_id   int REFERENCES users ON DELETE SET NULL,
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  stage_due_at     timestamptz,
  fault_ids        int[] NOT NULL DEFAULT '{}',
  fault_text       text,
  appearance       text[] NOT NULL DEFAULT '{}',
  appearance_note  text,
  kit              text[] NOT NULL DEFAULT '{}',
  kit_note         text,
  device_password  text,
  department       text,
  comment          text,
  estimated_cost   numeric(12, 2),
  accepted_by      int REFERENCES users ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  issued_at        timestamptz
);
CREATE INDEX orders_stage ON orders (stage_id);
CREATE INDEX orders_client ON orders (client_id);
CREATE INDEX orders_responsible ON orders (responsible_id);

-- История этапов: строка на каждый этап и на каждую передачу внутри этапа.
CREATE TABLE order_history (
  id             serial PRIMARY KEY,
  order_id       int NOT NULL REFERENCES orders ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'stage' CHECK (kind IN ('stage', 'transfer')),
  stage_id       int NOT NULL REFERENCES stages,
  responsible_id int REFERENCES users ON DELETE SET NULL,
  from_user_id   int REFERENCES users ON DELETE SET NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  due_at         timestamptz,
  finished_at    timestamptz,
  comment        text
);
CREATE INDEX order_history_order ON order_history (order_id, started_at);

CREATE TABLE tasks (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  creator_id    int NOT NULL REFERENCES users,
  assignee_id   int NOT NULL REFERENCES users,
  order_id      int REFERENCES orders ON DELETE CASCADE,
  client_id     int REFERENCES clients ON DELETE SET NULL,
  stage_id      int REFERENCES stages ON DELETE SET NULL,
  start_at      timestamptz NOT NULL DEFAULT now(),
  due_at        timestamptz NOT NULL,
  deadline_at   timestamptz,
  closed_at     timestamptz,
  closed_by     int REFERENCES users ON DELETE SET NULL,
  close_comment text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_assignee ON tasks (assignee_id, status);
CREATE INDEX tasks_creator ON tasks (creator_id, status);
CREATE INDEX tasks_due ON tasks (due_at);
CREATE INDEX tasks_order ON tasks (order_id);

-- Цепочка передачи задачи: каждый исполнитель — отдельный шаг.
CREATE TABLE task_steps (
  id           serial PRIMARY KEY,
  task_id      int NOT NULL REFERENCES tasks ON DELETE CASCADE,
  assignee_id  int NOT NULL REFERENCES users,
  from_user_id int REFERENCES users ON DELETE SET NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz,
  done_at      timestamptz,
  comment      text
);
CREATE INDEX task_steps_task ON task_steps (task_id, assigned_at);

CREATE TABLE notifications (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, is_read, created_at DESC);

CREATE TABLE attachments (
  id          serial PRIMARY KEY,
  order_id    int REFERENCES orders ON DELETE SET NULL,
  client_id   int REFERENCES clients ON DELETE SET NULL,
  file_name   text NOT NULL,
  stored_name text NOT NULL UNIQUE,
  mime        text NOT NULL,
  size        int NOT NULL,
  uploaded_by int REFERENCES users ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_order ON attachments (order_id);
CREATE INDEX attachments_client ON attachments (client_id);

CREATE SEQUENCE act_number_seq START 1;

CREATE TABLE acts (
  id                    serial PRIMARY KEY,
  number                text NOT NULL UNIQUE,
  order_id              int NOT NULL REFERENCES orders ON DELETE CASCADE,
  warranty_months       int NOT NULL DEFAULT 1,
  print_repeat_discount boolean NOT NULL DEFAULT false,
  note                  text,
  created_by            int REFERENCES users ON DELETE SET NULL,
  updated_by            int REFERENCES users ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acts_order ON acts (order_id);

CREATE TABLE act_items (
  id         serial PRIMARY KEY,
  act_id     int NOT NULL REFERENCES acts ON DELETE CASCADE,
  service_id int REFERENCES services ON DELETE SET NULL,
  name       text NOT NULL,
  qty        numeric(10, 2) NOT NULL DEFAULT 1,
  price      numeric(12, 2) NOT NULL DEFAULT 0,
  sort       int NOT NULL DEFAULT 0
);

-- Чек-лист парка техники юрлица по отделам.
CREATE TABLE fleet_rows (
  id         serial PRIMARY KEY,
  client_id  int NOT NULL REFERENCES clients ON DELETE CASCADE,
  department text NOT NULL,
  pc_count   int NOT NULL DEFAULT 0,
  mfu_count  int NOT NULL DEFAULT 0,
  reserve    boolean NOT NULL DEFAULT false,
  ssd_check  boolean NOT NULL DEFAULT false,
  note       text,
  sort       int NOT NULL DEFAULT 0
);
CREATE INDEX fleet_rows_client ON fleet_rows (client_id);
