import bcrypt from 'bcryptjs';
import { config } from '../config';

/** Хеш нового пароля. Стоимость берётся из настроек: на сервере 12, чтобы подбор по украденной базе занимал годы. */
export const hashPassword = (password: string) => bcrypt.hash(password, config.bcryptRounds);

/** Хеш сделан слабее нынешней стоимости: при входе его пересчитываем, пока пароль известен. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < config.bcryptRounds;
  } catch {
    return false;
  }
}
