-- Закупки: заявка на покупку проходит согласование, закупку и доставку. Отдельно от заявок на ремонт.
CREATE TABLE purchases (
  id          serial PRIMARY KEY,
  title       text NOT NULL,
  client_id   int REFERENCES clients ON DELETE SET NULL,
  comment     text,
  status      text NOT NULL DEFAULT 'approval' CHECK (status IN ('approval', 'buying', 'delivery', 'done', 'rejected', 'cancelled')),
  creator_id  int NOT NULL REFERENCES users,
  buyer_id    int NOT NULL REFERENCES users,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_status_idx ON purchases (status);

CREATE TABLE purchase_events (
  id           serial PRIMARY KEY,
  purchase_id  int NOT NULL REFERENCES purchases ON DELETE CASCADE,
  actor_id     int NOT NULL REFERENCES users,
  action       text NOT NULL CHECK (action IN ('created', 'approved', 'rejected', 'bought', 'delivered', 'cancelled')),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_events_purchase_idx ON purchase_events (purchase_id);
