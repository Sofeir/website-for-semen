-- Закупочная цена работы или детали: необязательная, видна всем сотрудникам. Рекомендованная цена продажи считается от неё (+20%).
ALTER TABLE device_works ADD COLUMN purchase_price numeric(12, 2) CHECK (purchase_price >= 0);
