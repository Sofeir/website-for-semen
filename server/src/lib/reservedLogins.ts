/**
 * Логины, которые заказчик не может взять себе ни при регистрации, ни при смене логина.
 * Это логины сотрудников (даже если учётка ещё не заведена или отключена) и служебные имена:
 * иначе заказчик мог бы занять логин, который руководитель собирается выдать сотруднику.
 * Сравнение без учёта регистра. Новый сотрудник с новым логином: добавьте его сюда.
 */
const RESERVED = [
  'semen',
  'leonid',
  'golenkov',
  'matvey',
  'isakov',
  'kataev',
  'maria',
  'admin',
  'administrator',
  'root',
  'support',
  'director',
  'manager',
  'master',
  'service',
];

export const isReservedLogin = (login: string) => RESERVED.includes(login.trim().toLowerCase());

export const RESERVED_LOGIN_MESSAGE = 'Этот логин зарезервирован для сотрудников, выберите другой';
