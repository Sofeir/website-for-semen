-- Закупочная цена, которую вписывают вместе с согласованной суммой (на согласовании или позже в заявке).
ALTER TABLE orders ADD COLUMN agreed_purchase numeric(12, 2) CHECK (agreed_purchase >= 0);
