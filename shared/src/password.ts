/** Пароли, которые подбирают первыми. Короткий список: главное отсечь очевидное, а не заставлять придумывать шифры. */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', '12341234', '87654321', '123123123', '1q2w3e4r', '1qaz2wsx',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'zxcvbnm1', 'qazwsxedc', 'password', 'password1', 'password123', 'passw0rd',
  'admin123', 'admin1234', 'administrator', 'letmein1', 'welcome1', 'iloveyou', 'abc12345', 'abcd1234', 'test1234', 'demo1234',
  'йцукенгш', 'йцукен123', 'пароль12', 'пароль123', 'qwerty12', 'sevice123', 'service123', 'asoft123', 'asoft1234',
]);

/** Причина, по которой пароль слишком слабый, или null, если он годится. Минимальную длину проверяет схема. */
export function weakPasswordReason(password: string, login?: string): string | null {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return 'Слишком простой пароль: его подбирают первым';
  if (/^(.)\1+$/.test(p)) return 'Пароль из одинаковых символов не годится';
  if (/^\d+$/.test(p) && p.length < 12) return 'Пароль только из цифр слишком короткий: добавьте буквы';
  if (login && login.length >= 3 && p.includes(login.toLowerCase())) return 'В пароле не должно быть логина';
  return null;
}
