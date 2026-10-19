-- Учёт техники: своя нумерация и место, журнал работ и замен (пробег), исход этапа «Готово» для отчётов.
ALTER TABLE devices ADD COLUMN inventory_no text;
ALTER TABLE devices ADD COLUMN location text;
CREATE INDEX devices_inventory ON devices (client_id, inventory_no);

CREATE TABLE device_works (
  id         serial PRIMARY KEY,
  client_id  int NOT NULL REFERENCES clients ON DELETE CASCADE,
  device_id  int REFERENCES devices ON DELETE CASCADE,
  order_id   int REFERENCES orders ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('refill', 'part', 'repair', 'service')),
  title      text NOT NULL,
  qty        int NOT NULL DEFAULT 1 CHECK (qty > 0),
  counter    int CHECK (counter >= 0),
  note       text,
  done_at    timestamptz NOT NULL DEFAULT now(),
  created_by int REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_works_client ON device_works (client_id, done_at);
CREATE INDEX device_works_device ON device_works (device_id, done_at);

-- Исход строки «Готово» в истории заявки: ремонт выполнен или клиент отказался. Для помесячных отчётов.
ALTER TABLE order_history ADD COLUMN outcome text CHECK (outcome IN ('repaired', 'declined'));
UPDATE order_history h SET outcome = 'repaired'
  FROM stages s WHERE s.id = h.stage_id AND s.code = 'ready' AND h.kind = 'stage';
