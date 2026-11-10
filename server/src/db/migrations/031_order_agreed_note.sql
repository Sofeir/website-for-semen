-- Запись о разговоре с клиентом на согласовании: что озвучили, какие варианты предложили, чего ждём.
ALTER TABLE orders ADD COLUMN agreed_note text;
