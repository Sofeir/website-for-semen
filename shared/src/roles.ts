/** Сотрудники сервис-центра. Заказчик (`customer`) — внешний пользователь, у него свой урезанный кабинет. */
/** `assistant` — сотрудник «только задачи»: видит «Сегодня», свои задачи и календарь, без заявок, клиентов и актов. */
export const STAFF_ROLES = ['admin', 'manager', 'diagnostician', 'master', 'assistant'] as const;
export const ROLES = [...STAFF_ROLES, 'customer'] as const;
export type Role = (typeof ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Руководитель системного администрирования',
  manager: 'Директор',
  diagnostician: 'Ведущий инженер',
  master: 'Инженер',
  assistant: 'Сотрудник: только задачи',
  customer: 'Заказчик',
};

/** Что может роль — коротко, для подсказки в «Сотрудниках». Сами права — в PERMISSIONS ниже. */
export const ROLE_RIGHTS: Record<StaffRole, string> = {
  admin: 'Полный доступ, как у директора: все заявки, задачи и акты, сотрудники, роли, справочники, реквизиты и импорт.',
  manager: 'Полный доступ, как у руководителя системного администрирования: принимает технику, видит все заявки, задачи и акты, назначает ответственных, подтверждает заказчиков, управляет сотрудниками, справочниками, реквизитами и импортом.',
  diagnostician:
    'Видит только свои заявки и задачи: где он ответственный, был им или где у него задача. Двигает свои заявки по этапам, оформляет акты, ставит задачи.',
  master: 'То же, что диагност: только свои заявки и задачи, свои этапы, акты и задачи коллегам.',
  assistant: 'Только «Сегодня», свои задачи и календарь. Заявки, клиенты и акты не видит. Может ставить задачи коллегам.',
};

/**
 * Права проверяются на сервере (middleware `requirePermission`) и
 * дублируются на клиенте только для того, чтобы не показывать лишние кнопки.
 */
export const PERMISSIONS = {
  /** Разделы «Заявки», «Клиенты», «Акты». У сотрудника «только задачи» их нет совсем. */
  'workspace.view': ['admin', 'manager', 'diagnostician', 'master'],
  'intake.create': ['admin', 'manager'],
  'clients.edit': ['admin', 'manager'],
  /** Видеть все заявки, акты и документы. Остальные — только те, где они ведут или вели заявку или у них задача по ней. */
  'orders.viewAll': ['admin', 'manager'],
  /** Двигать любую заявку по этапам. Остальные — только те, где они ответственные. */
  'orders.advanceAny': ['admin', 'manager'],
  /** Назначать ответственного по заявке без перехода этапа. */
  'orders.assign': ['admin', 'manager'],
  'tasks.create': ['admin', 'manager', 'diagnostician', 'master', 'assistant'],
  /** Видеть и закрывать задачи всех сотрудников, видеть чужие просрочки. */
  'tasks.manageAll': ['admin', 'manager'],
  'acts.edit': ['admin', 'manager', 'master', 'diagnostician'],
  'acts.delete': ['admin', 'manager'],
  'dictionaries.edit': ['admin', 'manager'],
  'users.manage': ['admin', 'manager'],
  'settings.edit': ['admin', 'manager'],
  'import.run': ['admin', 'manager'],
  /** Помесячные отчёты по клиентам: заправки, ремонты, парк техники. */
  'reports.view': ['admin', 'manager'],
  /** Подтверждать регистрации заказчиков и управлять их доступом. */
  'customers.manage': ['admin', 'manager'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
