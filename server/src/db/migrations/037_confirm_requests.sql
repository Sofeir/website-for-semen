-- Запросы к директору: «подтвердите закрытие» и «продлите срок» хранятся в самой задаче, чтобы директор видел список
-- «Ждут вашего подтверждения» с причиной, а не искал уведомления в колокольчике.
ALTER TABLE tasks ADD COLUMN confirm_kind text CHECK (confirm_kind IN ('close', 'extend'));
ALTER TABLE tasks ADD COLUMN confirm_comment text;
ALTER TABLE tasks ADD COLUMN confirm_by int REFERENCES users ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN confirm_at timestamptz;
ALTER TABLE tasks ADD COLUMN confirm_due timestamptz;
CREATE INDEX tasks_confirm ON tasks (confirm_at) WHERE confirm_kind IS NOT NULL;
