-- Одноразовые коды подключения Max: сотрудник нажимает «Подключить Max» на сайте, бот получает код и привязывает его аккаунт Max
CREATE TABLE max_link_codes (
  code        text PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX max_link_codes_user ON max_link_codes (user_id);
