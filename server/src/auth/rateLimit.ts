/**
 * Ограничение попыток входа: не больше MAX_FAILS неудачных попыток
 * на пару «IP + логин» и MAX_IP_FAILS на IP за окно WINDOW_MS.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const MAX_IP_FAILS = 30;

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

export function registerLoginFail(ip: string, login: string) {
  const now = Date.now();
  for (const key of [`${ip}|${login.toLowerCase()}`, ip]) {
    fails.set(key, [...recent(key), now]);
  }
}

export function resetLoginFails(ip: string, login: string) {
  fails.delete(`${ip}|${login.toLowerCase()}`);
}

export function _resetAllForTests() {
  fails.clear();
}
