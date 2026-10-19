import {
  CalendarDays,
  ClipboardList,
  FileText,
  ListChecks,
  PlusCircle,
  Settings2,
  Sun,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@sd/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Совпадение только по точному пути. */
  end?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Сегодня', icon: Sun, end: true },
  { to: '/orders', label: 'Заявки', icon: ClipboardList, permission: 'workspace.view' },
  { to: '/intake', label: 'Приём', icon: PlusCircle, permission: 'intake.create' },
  { to: '/tasks', label: 'Задачи', icon: ListChecks },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays },
  { to: '/clients', label: 'Клиенты', icon: Users, permission: 'workspace.view' },
  { to: '/customers', label: 'Заказчики', icon: UserCheck, permission: 'customers.manage' },
  { to: '/acts', label: 'Акты', icon: FileText, permission: 'workspace.view' },
  { to: '/settings', label: 'Настройки', icon: Settings2, permission: 'dictionaries.edit' },
];

/** Нижняя панель на телефоне: четыре главных раздела + «Ещё» (у сотрудника «только задачи» — три). */
export function bottomNav(canIntake: boolean, canWorkspace = true): string[] {
  if (!canWorkspace) return ['/', '/tasks', '/calendar'];
  return canIntake ? ['/', '/orders', '/intake', '/tasks'] : ['/', '/orders', '/tasks', '/calendar'];
}
