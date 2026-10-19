-- Роль «Сотрудник: только задачи» (assistant): видит «Сегодня», свои задачи и календарь, без заявок, клиентов и актов.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'diagnostician', 'master', 'assistant', 'customer'));
