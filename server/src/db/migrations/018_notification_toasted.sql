-- Было ли уведомление показано всплывающим окном. Если человека не было на сайте, при входе покажем пропущенные.
ALTER TABLE notifications ADD COLUMN toasted boolean NOT NULL DEFAULT false;
-- Всё, что накопилось до этой миграции, не показываем заново
UPDATE notifications SET toasted = true;
CREATE INDEX notifications_missed ON notifications (user_id, created_at DESC) WHERE NOT is_read AND NOT toasted;
