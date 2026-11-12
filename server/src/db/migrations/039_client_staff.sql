-- План месяца: за каждым сотрудником закреплены организации, которые он обслуживает. На одну организацию можно несколько сотрудников.
CREATE TABLE client_staff (
  client_id int NOT NULL REFERENCES clients ON DELETE CASCADE,
  user_id   int NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);
CREATE INDEX client_staff_user ON client_staff (user_id);
