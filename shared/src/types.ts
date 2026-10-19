import type { Role } from './roles';
import type { ClientKind, TaskStatus } from './schemas';

export interface Me {
  id: number;
  login: string;
  fullName: string;
  role: Role;
  phone: string | null;
  onboarded: boolean;
  notifyInApp: boolean;
  notifyTelegram: boolean;
  notifyMax: boolean;
  telegramChatId: string | null;
  maxUserId: string | null;
  /** Для заказчика — карточка клиента, к которой привязан кабинет. */
  clientId?: number | null;
  /** Какие внешние каналы включены на сервере (есть токен бота). */
  channels: { telegram: boolean; max: boolean };
}

export interface UserBrief {
  id: number;
  fullName: string;
  role: Role;
  login?: string;
  phone?: string | null;
  isActive?: boolean;
  /** false — роль пока предположение, её надо уточнить. Видит только администратор. */
  roleConfirmed?: boolean;
}

export interface Stage {
  id: number;
  code: string;
  name: string;
  sort: number;
  color: string;
  slaHours: number;
  isFinal: boolean;
  isActive: boolean;
}

export interface ClientBrief {
  id: number;
  kind: ClientKind;
  name: string;
  phone: string | null;
  contactPerson: string | null;
  inn: string | null;
}

export interface Client extends ClientBrief {
  phone2: string | null;
  email: string | null;
  address: string | null;
  kpp: string | null;
  note: string | null;
  createdAt: string;
  ordersCount?: number;
  activeCount?: number;
}

export interface Device {
  id: number;
  clientId: number;
  deviceTypeId: number;
  deviceType: string;
  brandId: number | null;
  brand: string | null;
  modelId: number | null;
  model: string | null;
  serial: string | null;
  title: string;
}

export interface OrderListItem {
  id: number;
  number: string;
  clientId: number;
  clientName: string;
  clientKind: ClientKind;
  clientPhone: string | null;
  deviceTitle: string;
  deviceType: string;
  serial: string | null;
  fault: string;
  stageId: number;
  stageCode: string;
  stageName: string;
  stageSort: number;
  stageColor: string;
  responsibleId: number | null;
  responsibleName: string | null;
  stageStartedAt: string;
  stageDueAt: string | null;
  createdAt: string;
  issuedAt: string | null;
  overdue: boolean;
}

export interface StageHistoryItem {
  id: number;
  kind: 'stage' | 'transfer';
  stageId: number;
  stageName: string;
  stageCode: string;
  responsibleId: number | null;
  responsibleName: string | null;
  fromUserName: string | null;
  startedAt: string;
  dueAt: string | null;
  finishedAt: string | null;
  comment: string | null;
}

export interface Attachment {
  id: number;
  fileName: string;
  mime: string;
  size: number;
  createdAt: string;
  uploadedBy: string | null;
  url: string;
}

export interface ActItem {
  id?: number;
  serviceId: number | null;
  name: string;
  qty: number;
  price: number;
}

export interface Act {
  id: number;
  number: string;
  orderId: number;
  orderNumber: string;
  clientId: number;
  clientName: string;
  deviceTitle: string;
  warrantyMonths: number;
  printRepeatDiscount: boolean;
  note: string | null;
  items: ActItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
}

export interface ActBrief {
  id: number;
  number: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  orderId: number;
  orderNumber: string;
  clientName: string;
  deviceTitle: string;
}

export interface OrderDetail extends OrderListItem {
  device: Device;
  faultIds: number[];
  appearance: string[];
  appearanceNote: string | null;
  kit: string[];
  kitNote: string | null;
  devicePassword: string | null;
  department: string | null;
  comment: string | null;
  estimatedCost: number | null;
  acceptedByName: string | null;
  history: StageHistoryItem[];
  attachments: Attachment[];
  acts: ActBrief[];
  tasks: TaskListItem[];
  batchId: number | null;
  receiptUrl: string;
  nextStage: Stage | null;
  canAdvance: boolean;
}

export interface TaskStep {
  id: number;
  assigneeId: number;
  assigneeName: string;
  fromUserName: string | null;
  assignedAt: string;
  dueAt: string | null;
  doneAt: string | null;
  comment: string | null;
}

export interface TaskListItem {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: number;
  assigneeName: string;
  creatorId: number;
  creatorName: string;
  orderId: number | null;
  orderNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  startAt: string;
  dueAt: string;
  deadlineAt: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closeComment: string | null;
  isStageTask: boolean;
  /** Задачу поставил заказчик из своего кабинета. */
  fromCustomer: boolean;
  overdue: boolean;
}

export interface TaskDetail extends TaskListItem {
  steps: TaskStep[];
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface DictItem {
  id: number;
  name: string;
  sort: number;
  isActive: boolean;
  parentId?: number | null;
  price?: number | null;
  priceFrom?: boolean;
  months?: number;
  isDefault?: boolean;
  color?: string;
  slaHours?: number;
  code?: string;
  isFinal?: boolean;
}

export interface Dictionaries {
  deviceTypes: DictItem[];
  brands: DictItem[];
  models: DictItem[];
  faults: DictItem[];
  appearance: DictItem[];
  kit: DictItem[];
  services: DictItem[];
  warranties: DictItem[];
  stages: Stage[];
}

export interface DashboardData {
  myTasksToday: TaskListItem[];
  overdue: TaskListItem[];
  overdueScope: 'mine' | 'all';
  newOrders: OrderListItem[];
  readyOrders: OrderListItem[];
  counts: { inWork: number; ready: number; overdue: number; today: number };
}

export interface FleetRowDto {
  id?: number;
  department: string;
  pcCount: number;
  mfuCount: number;
  reserve: boolean;
  ssdCheck: boolean;
  note: string | null;
}

export interface ClientDocument {
  kind: 'receipt' | 'act';
  id: number;
  number: string;
  createdAt: string;
  orderNumber: string;
  url: string;
}

export interface ClientDetail extends Client {
  devices: Device[];
  orders: OrderListItem[];
  tasks: TaskListItem[];
  documents: ClientDocument[];
  attachments: Attachment[];
  fleet: FleetRowDto[];
}

export interface IntakeResult {
  batchId: number;
  orderIds: number[];
  orderNumbers: string[];
  receiptUrl: string;
}

export interface ImportPreview {
  token: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  suggested: Record<string, number>;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

// ---------- Заказчик ----------

/** Задача заказчика в его кабинете: только то, что ему нужно знать. */
export interface CustomerTask {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeName: string;
  dueAt: string;
  createdAt: string;
  closedAt: string | null;
  closeComment: string | null;
}

/** Техника заказчика в ремонте — только чтение. */
export interface CustomerOrder {
  id: number;
  number: string;
  deviceTitle: string;
  stageName: string;
  stageCode: string;
  stageColor: string;
  isFinal: boolean;
  createdAt: string;
  issuedAt: string | null;
}

/** Строка в списке заказчиков у руководителя. */
export interface CustomerAccount {
  id: number;
  login: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  kind: ClientKind;
  pending: boolean;
  isActive: boolean;
  clientId: number | null;
  clientName: string | null;
  createdAt: string;
  tasksCount: number;
}

/** Один этап ремонта в карточке техники заказчика. */
export interface CustomerOrderStep {
  code: string;
  name: string;
  state: 'done' | 'current' | 'todo';
  startedAt: string | null;
}

/** Подробности по технике заказчика: что принято, на каком этапе, что дальше. */
export interface CustomerOrderDetail extends CustomerOrder {
  serial: string | null;
  fault: string;
  stageDueAt: string | null;
  responsibleName: string | null;
  steps: CustomerOrderStep[];
}

/** Контакты сервис-центра для кабинета заказчика. */
export interface CustomerCompany {
  name: string;
  phone: string;
  email: string;
  address: string;
  workHours: string;
}
