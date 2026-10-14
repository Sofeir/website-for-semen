export const ROLES = ['admin', 'manager', 'diagnostician', 'master'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  manager: 'Руководитель / приёмщик',
  diagnostician: 'Диагност',
  master: 'Мастер',
};

/**
 * Права проверяются на сервере (middleware `requirePermission`) и
 * дублируются на клиенте только для того, чтобы не показывать лишние кнопки.
 */
export const PERMISSIONS = {
  'intake.create': ['admin', 'manager'],
  'clients.edit': ['admin', 'manager'],
  /** Двигать любую заявку по этапам. Остальные — только те, где они ответственные. */
  'orders.advanceAny': ['admin', 'manager'],
  /** Назначать ответственного по заявке без перехода этапа. */
  'orders.assign': ['admin', 'manager'],
  'tasks.create': ['admin', 'manager', 'diagnostician', 'master'],
  /** Видеть и закрывать задачи всех сотрудников, видеть чужие просрочки. */
  'tasks.manageAll': ['admin', 'manager'],
  'acts.edit': ['admin', 'manager', 'master', 'diagnostician'],
  'acts.delete': ['admin', 'manager'],
  'dictionaries.edit': ['admin'],
  'users.manage': ['admin'],
  'settings.edit': ['admin'],
  'import.run': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
