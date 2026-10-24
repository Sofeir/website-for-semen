-- Проверка техники на выезде: чек-листы ПК и МФУ/принтеров (бланки Григория).

-- Пункты чек-листов лежат рядом с «внешним видом» и «комплектностью» и правятся в «Справочниках».
ALTER TABLE checklist_items DROP CONSTRAINT checklist_items_kind_check;
ALTER TABLE checklist_items
  ADD CONSTRAINT checklist_items_kind_check CHECK (kind IN ('appearance', 'kit', 'inspect_pc', 'inspect_printer'));

INSERT INTO checklist_items (kind, name, sort) VALUES
  ('inspect_pc', 'Проверка состояния дисков', 10),
  ('inspect_pc', 'Проверка антивируса', 20),
  ('inspect_pc', 'Проверка активации продуктов Microsoft', 30),
  ('inspect_pc', 'Проверка наличия ошибок в системе', 40),
  ('inspect_pc', 'Проверка резервных копий', 50),
  ('inspect_pc', 'Проверка быстродействия системы', 60),
  ('inspect_pc', 'Очистка устройства от пыли', 70),
  ('inspect_printer', 'Проверка качества печати', 10),
  ('inspect_printer', 'Проверка состояния роликов подачи бумаги', 20),
  ('inspect_printer', 'Проверка состояния печки', 30),
  ('inspect_printer', 'Проверка состояния фотобарабана', 40),
  ('inspect_printer', 'Проверка остатка тонера', 50),
  ('inspect_printer', 'Проверка бункера отработанного тонера', 60),
  ('inspect_printer', 'Очистка устройства', 70);

-- Имя ПК в сети (в бланке «Имя ПК»).
ALTER TABLE devices ADD COLUMN host_name text;

-- Одна проверка одной единицы техники. Пункты хранятся копией: правка справочника не меняет прошлые проверки.
CREATE TABLE device_inspections (
  id           serial PRIMARY KEY,
  client_id    int NOT NULL REFERENCES clients ON DELETE CASCADE,
  device_id    int NOT NULL REFERENCES devices ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('pc', 'printer')),
  performer_id int REFERENCES users ON DELETE SET NULL,
  inspected_at timestamptz NOT NULL DEFAULT now(),
  person_name  text,
  person_phone text,
  counter      int CHECK (counter >= 0),
  note         text,
  items        jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_inspections_client ON device_inspections (client_id, inspected_at DESC);
CREATE INDEX device_inspections_device ON device_inspections (device_id, inspected_at DESC);
