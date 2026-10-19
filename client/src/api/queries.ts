import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  Act,
  ActBrief,
  ActInput,
  AdvanceOrderInput,
  ClientDetail,
  Client,
  CloseTasksInput,
  CustomerAccount,
  CustomerCompany,
  CustomerOrder,
  CustomerOrderDetail,
  CustomerTask,
  CompanySettings,
  DashboardData,
  Device,
  DeviceWork,
  MonthlyReport,
  Dictionaries,
  IntakeResult,
  Me,
  NotificationItem,
  OrderDetail,
  OrderListItem,
  Paged,
  ReassignOrderInput,
  ReopenOrderInput,
  TaskDetail,
  TaskKind,
  TaskListItem,
  TransferTaskInput,
  ServicePlan,
  VisitsData,
  UserBrief,
  WorkSettings,
} from '@sd/shared';
import { api, qs } from './http';

export const keys = {
  me: ['me'] as const,
  dictionaries: ['dictionaries'] as const,
  settings: ['settings'] as const,
  users: ['users'] as const,
  dashboard: ['dashboard'] as const,
  orders: (f?: object) => ['orders', f ?? {}] as const,
  order: (id: number) => ['order', id] as const,
  clients: (f?: object) => ['clients', f ?? {}] as const,
  client: (id: number) => ['client', id] as const,
  clientDevices: (id: number) => ['clientDevices', id] as const,
  tasks: (f?: object) => ['tasks', f ?? {}] as const,
  task: (id: number) => ['task', id] as const,
  notifications: ['notifications'] as const,
  acts: (f?: object) => ['acts', f ?? {}] as const,
  act: (id: number) => ['act', id] as const,
  customers: ['customers'] as const,
  customerTasks: ['customerTasks'] as const,
  customerOrders: ['customerOrders'] as const,
  customerOrder: (id: number) => ['customerOrder', id] as const,
  customerCompany: ['customerCompany'] as const,
};

/** Какие запросы сбрасывать, когда сервер сообщил «изменилось X». */
export const SCOPE_KEYS: Record<string, string[]> = {
  orders: ['orders', 'order', 'dashboard', 'customerOrders', 'customerOrder', 'deviceWorks', 'clientWorks', 'report'],
  tasks: ['tasks', 'task', 'dashboard', 'order', 'customerTasks', 'visits', 'taskKinds'],
  customers: ['customers'],
  clients: ['clients', 'client', 'deviceWorks', 'clientWorks', 'report', 'clientDevices', 'serviceChecklist', 'servicePlan', 'servicePlans', 'visits'],
  dashboard: ['dashboard'],
  dictionaries: ['dictionaries'],
  acts: ['acts', 'act', 'order'],
};

export interface MeResponse {
  user: Me;
  csrfToken: string;
  appName: string;
}

export const useDictionaries = () =>
  useQuery({ queryKey: keys.dictionaries, queryFn: () => api.get<Dictionaries>('/dictionaries'), staleTime: 5 * 60_000 });

export const useSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<{ company: CompanySettings; work: WorkSettings }>('/settings'),
    staleTime: 10 * 60_000,
  });

export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => api.get<UserBrief[]>('/users'), staleTime: 5 * 60_000 });

export const useDeviceWorks = (deviceId: number | null) =>
  useQuery({
    queryKey: ['deviceWorks', deviceId],
    queryFn: () => api.get<DeviceWork[]>(`/devices/${deviceId}/works`),
    enabled: Boolean(deviceId),
  });

export const useClientWorks = (clientId: number, enabled = true) =>
  useQuery({
    queryKey: ['clientWorks', clientId],
    queryFn: () => api.get<DeviceWork[]>(`/clients/${clientId}/works`),
    enabled,
  });

export const useMonthlyReport = (month: string) =>
  useQuery({
    queryKey: ['report', month],
    queryFn: () => api.get<MonthlyReport>(`/reports/monthly?month=${month}`),
    placeholderData: keepPreviousData,
  });

export const useTaskKinds = () =>
  useQuery({ queryKey: ['taskKinds'], queryFn: () => api.get<TaskKind[]>('/task-kinds'), staleTime: 60_000 });

export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<DashboardData>('/dashboard'), refetchInterval: 120_000 });

export interface OrderFilters {
  q?: string;
  stage?: number | '';
  responsible?: number | '';
  mine?: boolean;
  kind?: string;
  overdue?: boolean;
  issued?: string;
  sort?: string;
  client?: number;
}

export const useOrders = (f: OrderFilters = {}, enabled = true) =>
  useQuery({
    queryKey: keys.orders(f),
    queryFn: () => api.get<OrderListItem[]>(`/orders${qs(f as Record<string, string>)}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useOrder = (id: number) =>
  useQuery({ queryKey: keys.order(id), queryFn: () => api.get<OrderDetail>(`/orders/${id}`), enabled: id > 0 });

export const useClients = (f: { q?: string; kind?: string; limit?: number; offset?: number } = {}, enabled = true) =>
  useQuery({
    queryKey: keys.clients(f),
    queryFn: () => api.get<Paged<Client>>(`/clients${qs(f)}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useClient = (id: number) =>
  useQuery({ queryKey: keys.client(id), queryFn: () => api.get<ClientDetail>(`/clients/${id}`), enabled: id > 0 });

export const useClientDevices = (id: number | null | undefined) =>
  useQuery({
    queryKey: keys.clientDevices(id ?? 0),
    queryFn: () => api.get<Device[]>(`/clients/${id}/devices`),
    enabled: Boolean(id),
  });

export interface TaskFilters {
  scope?: 'mine' | 'created' | 'all';
  status?: 'open' | 'done' | 'any';
  q?: string;
  assignee?: number | '';
  overdue?: boolean;
  from?: string;
  to?: string;
  order?: number;
}

export const useTasks = (f: TaskFilters = {}) =>
  useQuery({
    queryKey: keys.tasks(f),
    queryFn: () => api.get<TaskListItem[]>(`/tasks${qs(f as Record<string, string>)}`),
    placeholderData: keepPreviousData,
  });

export const useTask = (id: number | null) =>
  useQuery({ queryKey: keys.task(id ?? 0), queryFn: () => api.get<TaskDetail>(`/tasks/${id}`), enabled: Boolean(id) });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications?limit=60'),
    refetchInterval: 5 * 60_000,
  });

export const useActs = (f: { order?: number } = {}) =>
  useQuery({ queryKey: keys.acts(f), queryFn: () => api.get<ActBrief[]>(`/acts${qs(f)}`) });

export const useAct = (id: number) =>
  useQuery({ queryKey: keys.act(id), queryFn: () => api.get<Act>(`/acts/${id}`), enabled: id > 0 });

export const useCustomers = () => useQuery({ queryKey: keys.customers, queryFn: () => api.get<CustomerAccount[]>('/customers') });

export const useCustomerTasks = () =>
  useQuery({ queryKey: keys.customerTasks, queryFn: () => api.get<CustomerTask[]>('/customer/tasks') });

export const useCustomerOrders = () =>
  useQuery({ queryKey: keys.customerOrders, queryFn: () => api.get<CustomerOrder[]>('/customer/orders') });

export const useCustomerOrder = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: keys.customerOrder(id),
    queryFn: () => api.get<CustomerOrderDetail>(`/customer/orders/${id}`),
    enabled,
  });

export const useCustomerCompany = () =>
  useQuery({
    queryKey: keys.customerCompany,
    queryFn: () => api.get<CustomerCompany>('/customer/company'),
    staleTime: 10 * 60_000,
  });

export const useServiceChecklist = (clientId: number) =>
  useQuery({
    queryKey: ['serviceChecklist', clientId],
    queryFn: () => api.get<{ items: string[] }>(`/clients/${clientId}/service-checklist`),
    enabled: clientId > 0,
  });

export const useServicePlan = (clientId: number) =>
  useQuery({
    queryKey: ['servicePlan', clientId],
    queryFn: () => api.get<{ plan: ServicePlan | null }>(`/clients/${clientId}/service-plan`),
    enabled: clientId > 0,
  });

export const useVisits = (f: { assignee?: string; status?: 'open' | 'done' }) =>
  useQuery({
    queryKey: ['visits', f],
    queryFn: () => api.get<VisitsData>(`/visits${qs(f as Record<string, string>)}`),
    placeholderData: keepPreviousData,
  });

/** Инвалидация после изменений, чтобы списки и карточки обновились сразу. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...roots: string[]) => Promise.all(roots.map((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r })));
}

export function useAdvanceOrder(orderId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: AdvanceOrderInput) => api.post(`/orders/${orderId}/advance`, input as any),
    onSuccess: () => inv('orders', 'order', 'tasks', 'dashboard', 'client'),
  });
}

export function useReassignOrder(orderId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: ReassignOrderInput) => api.post(`/orders/${orderId}/reassign`, input as any),
    onSuccess: () => inv('orders', 'order', 'tasks', 'dashboard'),
  });
}

export function useReopenOrder(orderId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: ReopenOrderInput) => api.post(`/orders/${orderId}/reopen`, input as any),
    onSuccess: () => inv('orders', 'order', 'tasks', 'dashboard', 'client'),
  });
}

export function useCloseTasks() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: CloseTasksInput) => api.post<{ closed: number[]; skipped: number[] }>('/tasks/close', input as any),
    onSuccess: () => inv('tasks', 'task', 'dashboard', 'order', 'client'),
  });
}

export function useTransferTask(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: TransferTaskInput) => api.post(`/tasks/${id}/transfer`, input as any),
    onSuccess: () => inv('tasks', 'task', 'dashboard', 'order', 'orders'),
  });
}

export function useSaveAct(id?: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: ActInput) => (id ? api.put<Act>(`/acts/${id}`, input as any) : api.post<Act>('/acts', input as any)),
    onSuccess: () => inv('acts', 'act', 'order', 'client'),
  });
}

export type { IntakeResult };
