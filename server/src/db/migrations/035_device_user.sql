-- Пользователь техники: человек из организации, который работает на этом аппарате. Меняется, когда техника переезжает.
-- Отдельно от «кто подал заявку»: он остаётся в заявке.
ALTER TABLE devices ADD COLUMN user_contact_id int REFERENCES client_contacts ON DELETE SET NULL;
