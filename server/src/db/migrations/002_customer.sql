-- Роль «Заказчик»: внешний пользователь, который сам регистрируется, ставит задачи и видит только свои.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'diagnostician', 'master', 'customer'));

-- Карточка клиента, к которой привязан кабинет заказчика.
ALTER TABLE users ADD COLUMN client_id int REFERENCES clients ON DELETE SET NULL;
-- Регистрация ждёт подтверждения руководителем: пока pending, войти нельзя.
ALTER TABLE users ADD COLUMN pending boolean NOT NULL DEFAULT false;
-- Данные, которые заказчик указал при регистрации (карточка клиента создаётся при подтверждении).
ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN reg_kind text CHECK (reg_kind IN ('person', 'legal'));
ALTER TABLE users ADD COLUMN reg_contact text;

CREATE INDEX users_client ON users (client_id);
