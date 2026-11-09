-- Всплывающие уведомления на телефоне и компьютере (Web Push). Ключи сервера создаются сами при первом запуске.
CREATE TABLE IF NOT EXISTS push_keys (
  id          int PRIMARY KEY CHECK (id = 1),
  public_key  text NOT NULL,
  private_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
