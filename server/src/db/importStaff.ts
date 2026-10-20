import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { STAFF_ROLES, type StaffRole } from '@sd/shared';
import { migrate } from './migrate';
import { one, pool } from './pool';

/**
 * Заводит или обновляет сотрудников из локального файла `staff.local.json` в корне проекта.
 * Файл в .gitignore: настоящие ФИО и телефоны не попадают в публичный репозиторий.
 * Образец формата: `staff.example.json`.
 *
 * Запуск: npm run staff:import --workspace server -- [--only] [путь к файлу]
 *   --only  отключить всех остальных сотрудников (демо-людей и тех, кого нет в файле): они пропадут из выбора
 *           ответственных, а история заявок и задач сохранится. Заказчиков (клиентские кабинеты) не трогает.
 * Пароль берётся из STAFF_PASSWORD, а если его нет, для каждого нового сотрудника создаётся свой случайный.
 * Случайные пароли пишутся в staff.passwords.local.txt (в .gitignore) и в терминал не выводятся.
 * Существующим сотрудникам пароль не меняется.
 */
interface StaffEntry {
  login: string;
  fullName: string;
  role: StaffRole;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readEntries(file: string): StaffEntry[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw) || !raw.length) throw new Error('В файле должен быть непустой список сотрудников');
  return raw.map((e, i) => {
    if (!e || typeof e.login !== 'string' || !/^[a-zA-Z0-9._-]{3,64}$/.test(e.login)) throw new Error(`Запись ${i + 1}: неверный login`);
    if (typeof e.fullName !== 'string' || e.fullName.trim().length < 2) throw new Error(`Запись ${i + 1}: нет ФИО`);
    if (!STAFF_ROLES.includes(e.role)) throw new Error(`Запись ${i + 1}: роль должна быть одной из ${STAFF_ROLES.join(', ')}`);
    return { login: e.login, fullName: e.fullName.trim(), role: e.role, position: e.position?.trim() || null, phone: e.phone?.trim() || null, email: e.email?.trim() || null };
  });
}

(async () => {
  const args = process.argv.slice(2);
  const only = args.includes('--only');
  const file = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, 'staff.local.json'));
  if (!fs.existsSync(file)) throw new Error(`Нет файла ${file}. Скопируйте staff.example.json в staff.local.json и заполните.`);
  const entries = readEntries(file);
  await migrate();
  const shared = process.env.STAFF_PASSWORD;
  if (shared && shared.length < 8) throw new Error('STAFF_PASSWORD короче 8 символов');
  const issued: string[] = [];
  for (const e of entries) {
    const have = await one<{ id: number }>('SELECT id FROM users WHERE lower(login) = lower($1)', [e.login]);
    if (have) {
      await pool.query('UPDATE users SET full_name = $2, role = $3, position = $4, phone = $5, email = coalesce($6, email), role_confirmed = true, is_active = true WHERE id = $1', [
        have.id,
        e.fullName,
        e.role,
        e.position,
        e.phone,
        e.email,
      ]);
      console.log(`обновлён: ${e.login} (${e.fullName}), пароль не менялся`);
      continue;
    }
    const password = shared ?? crypto.randomBytes(9).toString('base64url');
    await pool.query(
      `INSERT INTO users (login, password_hash, full_name, role, phone, email, position, role_confirmed) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [e.login, await bcrypt.hash(password, 10), e.fullName, e.role, e.phone, e.email, e.position],
    );
    if (!shared) issued.push(`${e.login}\t${e.fullName}\t${password}`);
    console.log(`создан: ${e.login} (${e.fullName}), ${shared ? 'общий пароль из STAFF_PASSWORD' : 'пароль в staff.passwords.local.txt'}`);
  }
  if (issued.length) {
    const out = path.join(root, 'staff.passwords.local.txt');
    fs.appendFileSync(out, `${issued.join('\n')}\n`, { mode: 0o600 });
    console.log(`Пароли новых сотрудников записаны в ${out}. Передайте их людям и удалите файл.`);
  }
  if (only) {
    const logins = entries.map((e) => e.login.toLowerCase());
    const r = await pool.query(
      `UPDATE users SET is_active = false WHERE role <> 'customer' AND is_active AND NOT (lower(login) = ANY ($1))`,
      [logins],
    );
    await pool.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role <> 'customer' AND NOT is_active)`);
    console.log(`отключено лишних сотрудников: ${r.rowCount}`);
  }
  await pool.end();
})().catch(async (err) => {
  console.error(err.message ?? err);
  await pool.end().catch(() => {});
  process.exit(1);
});
