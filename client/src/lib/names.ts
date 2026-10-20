/** Имя для приветствия сотрудника. ФИО пишут «Фамилия Имя Отчество», поэтому берём второе слово. */
export function staffFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : parts[0];
}
