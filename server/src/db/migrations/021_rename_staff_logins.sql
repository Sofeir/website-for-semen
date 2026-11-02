-- Логины сотрудников приведены к фамилиям/именам латиницей (02.11.2026, просьба заказчика).
-- Меняем только того, у кого совпадает и старый логин, и ФИО, и только если новый логин свободен:
-- так не заденем чужих людей и повторный запуск ничего не сломает.
-- Порядок важен: сначала заказчица maria, потом Мария Викторовна olga занимает освободившийся maria.
UPDATE users SET login = 'maria.lebedeva'
 WHERE login = 'maria' AND role = 'customer' AND full_name = 'Мария Лебедева'
   AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'maria.lebedeva');

UPDATE users SET login = 'leonid'
 WHERE login = 'artem' AND full_name = 'Тафлевич Леонид Беневич'
   AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'leonid');

UPDATE users SET login = 'golenkov'
 WHERE login = 'admin' AND full_name = 'Голенков Григорий Сергеевич'
   AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'golenkov');

UPDATE users SET login = 'isakov'
 WHERE login = 'stas' AND full_name = 'Исаков Григорий Вячеславович'
   AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'isakov');

UPDATE users SET login = 'kataev'
 WHERE login = 'lenya' AND full_name = 'Катаев Артем Дмитриевич'
   AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'kataev');

UPDATE users SET login = 'maria'
 WHERE login = 'olga' AND full_name = 'Тафлевич Мария Викторовна'
   AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'maria');
