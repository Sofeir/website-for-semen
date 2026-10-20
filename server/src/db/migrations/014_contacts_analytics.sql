-- Люди организаций (кто подал заявку), согласованные срок и сумма, исполнители и суммы работ,
-- комплектация рабочего места, должности сотрудников.
ALTER TABLE users ADD COLUMN position text;

CREATE TABLE client_contacts (
  id               serial PRIMARY KEY,
  client_id        int NOT NULL REFERENCES clients ON DELETE CASCADE,
  full_name        text NOT NULL,
  phone            text,
  phone_digits     text,
  position         text,
  -- тот же человек как частный клиент: личную технику не заводим дважды
  person_client_id int REFERENCES clients ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_contacts_client ON client_contacts (client_id);
CREATE INDEX client_contacts_person ON client_contacts (person_client_id);

ALTER TABLE orders ADD COLUMN contact_id int REFERENCES client_contacts ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN agreed_term text;
ALTER TABLE orders ADD COLUMN agreed_sum numeric(12, 2) CHECK (agreed_sum >= 0);

-- Комплектующее входит в рабочее место: монитор и периферия привязаны к системному блоку.
ALTER TABLE devices ADD COLUMN parent_id int REFERENCES devices ON DELETE SET NULL;
CREATE INDEX devices_parent ON devices (parent_id);

ALTER TABLE device_works ADD COLUMN performer_id int REFERENCES users ON DELETE SET NULL;
ALTER TABLE device_works ADD COLUMN amount numeric(12, 2) CHECK (amount >= 0);
ALTER TABLE device_works ADD COLUMN part_brand text;
ALTER TABLE device_works ADD COLUMN part_spec text;
ALTER TABLE device_works ADD COLUMN warranty_months int CHECK (warranty_months >= 0);
-- расчётный ресурс детали, листов: по нему ловим замену раньше срока
ALTER TABLE device_works ADD COLUMN resource int CHECK (resource > 0);
-- из чего состояла заправка: заправка, фотобарабан, ролик заряда, чип, ракель
ALTER TABLE device_works ADD COLUMN ops text[] NOT NULL DEFAULT '{}';
CREATE INDEX device_works_order ON device_works (order_id);
