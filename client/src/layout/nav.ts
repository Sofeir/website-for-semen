import {
  CalendarDays,
  ClipboardList,
  FileText,
  ListChecks,
  PlusCircle,
  Settings2,
  Sun,
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
  { to: '/orders', label: 'Заявки', icon: ClipboardList },
  { to: '/intake', label: 'Приём', icon: PlusCircle, permission: 'intake.create' },
  { to: '/tasks', label: 'Задачи', icon: ListChecks },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/acts', label: 'Акты', icon: FileText },
  { to: '/settings', label: 'Настройки', icon: Settings2, permission: 'dictionaries.edit' },
];

/** Нижняя панель на телефоне: четыре главных раздела + «Ещё». */
export function bottomNav(canIntake: boolean): string[] {
  return canIntake ? ['/', '/orders', '/intake', '/tasks'] : ['/', '/orders', '/tasks', '/calendar'];
}
