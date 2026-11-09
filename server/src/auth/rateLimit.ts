/**
 * Ограничение попыток входа: не больше MAX_FAILS неудачных попыток
 * на пару «IP + логин» и MAX_IP_FAILS на IP за окно WINDOW_MS.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const MAX_IP_FAILS = 30;
/**
 * Подбор пароля одного логина с разных адресов: после стольких неудач за окно каждая следующая попытка идёт с задержкой.
 * Вход не закрываем совсем: иначе чужой человек с сотни адресов мог бы не пускать директора в его же сервис.
 */
const MAX_LOGIN_FAILS = 60;
const SLOW_LOGIN_MS = 3000;

const fails = new Map<string, number[]>();

function recent(key: string) {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) fails.set(key, list);
  else fails.delete(key);
  return list;
}

/** Сколько секунд ждать до следующей попытки, 0 — можно. */
export function loginRetryAfter(ip: string, login: string): number {
  const pair = recent(`${ip}|${login.toLowerCase()}`);
  const byIp = recent(ip);
  const blocked = pair.length >= MAX_FAILS ? pair : byIp.length >= MAX_IP_FAILS ? byIp : null;
  if (!blocked) return 0;
  return Math.ceil((blocked[0] + WINDOW_MS - Date.now()) / 1000);
}

/** Сколько миллисекунд подержать попытку входа, если этот логин сейчас подбирают с разных адресов. Верный пароль пускает и так. */
export function loginDelayMs(login: string): number {
  return recent(`login|${login.toLowerCase()}`).length >= MAX_LOGIN_FAILS ? SLOW_LOGIN_MS : 0;
}

export function registerLoginFail(ip: string, login: string) {
  const now = Date.now();
  for (const key of [`${ip}|${login.toLowerCase()}`, ip, `login|${login.toLowerCase()}`]) {
    fails.set(key, [...recent(key), now]);
  }
}

export function resetLoginFails(ip: string, login: string) {
  fails.delete(`${ip}|${login.toLowerCase()}`);
}

/** Настоящий вход состоялся: счётчик подбора этого логина обнуляется. */
export function clearLoginSpray(login: string) {
  fails.delete(`login|${login.toLowerCase()}`);
}

export function _resetAllForTests() {
  fails.clear();
}
