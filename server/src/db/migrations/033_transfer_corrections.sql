-- «Передал не тому»: ошибочная передача заменяется в цепочке, а не дописывается. Здесь остаётся след для разбора.
CREATE TABLE transfer_corrections (
  id             serial PRIMARY KEY,
  task_id        int REFERENCES tasks ON DELETE CASCADE,
  order_id       int REFERENCES orders ON DELETE CASCADE,
  actor_id       int REFERENCES users ON DELETE SET NULL,
  wrong_user_id  int REFERENCES users ON DELETE SET NULL,
  wrong_comment  text,
  corrected_at   timestamptz NOT NULL DEFAULT now()
);
