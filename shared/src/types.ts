import type { Role } from './roles';
import type { ClientKind, TaskStatus } from './schemas';

export interface Me {
  id: number;
  login: string;
  fullName: string;
  role: Role;
  phone: string | null;
  position?: string | null;
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
  /** Должность: директор, ведущий инженер и так далее. Может быть пустой. */
  position?: string | null;
  email?: string | null;
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
  /** Своя нумерация предприятия и где стоит (кабинет, отдел). */
  inventoryNo: string | null;
  location: string | null;
  /** Системный блок или ноутбук, в состав рабочего места которого входит эта техника. */
  parentId: number | null;
}

export interface Contact {
  id: number;
  clientId: number;
  fullName: string;
  phone: string | null;
  position: string | null;
  personClientId: number | null;
}

/** Человек из любой организации — для подсказок при приёме от физлица. */
export interface ContactHit extends Contact {
  clientName: string;
}

export interface DeviceWork {
  id: number;
  clientId: number;
  deviceId: number | null;
  orderId: number | null;
  orderNumber: string | null;
  kind: 'refill' | 'part' | 'repair' | 'service';
  title: string;
  qty: number;
  /** Пробег устройства на момент работы, листов. */
  counter: number | null;
  note: string | null;
  doneAt: string;
  createdByName: string | null;
  performerId: number | null;
  performerName: string | null;
  amount: number | null;
  partBrand: string | null;
  partSpec: string | null;
  warrantyMonths: number | null;
  /** Расчётный ресурс детали, листов. */
  resource: number | null;
  ops: string[];
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
  kind: 'stage' | 'transfer' | 'reopen';
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
  /** Филиал и сотрудник организации, от которого пришла заявка. */
  branch: string | null;
  requesterName: string | null;
  contact: Contact | null;
  /** Согласовано с клиентом: срок текстом и сумма. */
  agreedTerm: string | null;
  agreedSum: number | null;
  /** Работы по заявке: кто и что делал. */
  works: DeviceWork[];
  comment: string | null;
  estimatedCost: number | null;
  acceptedByName: string | null;
  deviceReturnedAt: string | null;
  /** repaired — отремонтировано, declined — без ремонта (отказ на согласовании). */
  outcome: 'repaired' | 'declined' | null;
  reopenCount: number;
  canReopen: boolean;
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
  /** Пункты чек-листа: всего и отмечено. */
  checklistTotal: number;
  checklistDone: number;
  /** Выезд к клиенту. */
  isVisit: boolean;
  kindId: number | null;
  kindName: string | null;
  kindColor: string | null;
  overdue: boolean;
}

export interface TaskKind {
  id: number;
  code: string | null;
  name: string;
  color: string;
  sort: number;
  isActive: boolean;
}

export interface TaskChecklistItem {
  id: number;
  title: string;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
}

export interface TaskDetail extends TaskListItem {
  steps: TaskStep[];
  checklist: TaskChecklistItem[];
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

/** Проверка единицы техники на выезде (чек-лист ПК или МФУ). */
export interface Inspection {
  id: number;
  clientId: number;
  deviceId: number;
  kind: 'pc' | 'printer';
  deviceTitle: string;
  deviceType: string;
  inventoryNo: string | null;
  location: string | null;
  hostName: string | null;
  inspectedAt: string;
  performerId: number | null;
  performerName: string | null;
  personName: string | null;
  personPhone: string | null;
  counter: number | null;
  note: string | null;
  /** Выезд, при котором проводилась проверка. */
  taskId: number | null;
  items: { title: string; done: boolean; comment?: string | null }[];
}

/** Техника клиента в выезде: бланк проверки, прошлая проверка и проверка в этом выезде. */
export interface VisitDevice {
  id: number;
  title: string;
  deviceType: string;
  kind: 'pc' | 'printer';
  inventoryNo: string | null;
  location: string | null;
  hostName: string | null;
  /** Последняя проверка этой техники (в любом выезде): из неё подставляем сотрудника и имя ПК. */
  previous: Inspection | null;
  /** Проверка в этом выезде. */
  current: Inspection | null;
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
  inspectPc: DictItem[];
  inspectPrinter: DictItem[];
  /** Стандартные работы выезда: подставляются, когда у клиента нет своего списка. */
  visitWorks: DictItem[];
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

export interface ReportTotals {
  /** Заявки, принятые в месяце. */
  accepted: number;
  /** Ремонты, доведённые до «Готово». */
  repaired: number;
  /** Заявки без ремонта: клиент отказался на согласовании. */
  declined: number;
  /** Заправлено картриджей (по количеству). */
  refills: number;
  /** Заменено деталей. */
  parts: number;
  /** Прочие работы: ремонт и обслуживание в журнале техники. */
  otherWorks: number;
  /** Выезды: закрытые задачи-выезды за месяц. */
  visits: number;
}

export interface ReportRow extends ReportTotals {
  clientId: number;
  clientName: string;
  kind: 'person' | 'legal';
  /** Сколько единиц техники клиента в базе. */
  devices: number;
}

export interface ClientReportWork {
  id: number;
  kind: 'refill' | 'part' | 'repair' | 'service';
  title: string;
  qty: number;
  counter: number | null;
  amount: number | null;
  doneAt: string;
  ops: string[];
  /** Заявка, по которой сделана работа: по ней можно перейти. */
  orderId: number | null;
  orderNumber: string | null;
  /** Номер и название техники, если работа привязана к устройству. */
  deviceTitle: string | null;
}

/** Выезд к клиенту: закрытая задача-выезд. */
export interface ClientReportVisit {
  id: number;
  title: string;
  closedAt: string;
  /** Кто закрыл выезд (или исполнитель, если закрыл другой). */
  performerName: string | null;
  checklistDone: number;
  checklistTotal: number;
  /** Сколько единиц техники проверили в этом выезде. */
  inspected: number;
  closeComment: string | null;
}

export interface ClientReportOrder {
  id: number;
  number: string;
  deviceTitle: string;
  stageName: string;
  createdAt: string;
  /** Принята в этом месяце. */
  acceptedInMonth: boolean;
  /** Итог, который случился в этом месяце: ремонт выполнен или без ремонта. */
  outcome: 'repaired' | 'declined' | null;
  outcomeAt: string | null;
  /** Работы по этой заявке за месяц. */
  works: ClientReportWork[];
}

/** Что сделали для одной организации за месяц: основа для счёта. */
// ---------- Аналитика ----------

export interface AnalyticsTotals {
  requests: number;
  /** Закрытые выезды за период. */
  visits: number;
  repaired: number;
  declined: number;
  refills: number;
  works: number;
  /** Сумма из журнала работ, ₽. */
  revenue: number;
  /** Средний срок от приёма до выдачи, дней. */
  avgDays: number | null;
  warrantyReturns: number;
  activeClients: number;
}

export interface AnalyticsTrendPoint extends AnalyticsTotals {
  month: string;
}

export interface AnalyticsMaster {
  userId: number;
  name: string;
  position: string | null;
  works: number;
  orders: number;
  refills: number;
  revenue: number;
  /** Закрытых выездов за месяц. */
  visits: number;
  /** Сколько этапов заявок вёл за месяц. */
  stages: number;
}

export interface AnalyticsDevice {
  deviceId: number;
  title: string;
  inventoryNo: string | null;
  clientId: number;
  clientName: string;
  works: number;
  revenue: number;
  lastWorkAt: string;
  /** Сколько раз деталь заменили раньше расчётного ресурса. */
  early: number;
}

export interface AnalyticsClient {
  clientId: number;
  name: string;
  kind: 'person' | 'legal';
  requests: number;
  allTime: number;
  revenue: number;
  regular: boolean;
}

export interface EarlyReplacement {
  deviceId: number;
  title: string;
  clientName: string;
  part: string;
  /** Сколько листов прошло с прошлой замены. */
  passed: number;
  /** Расчётный ресурс прошлой детали. */
  resource: number;
  doneAt: string;
}

/** Одна запись из журнала работ инженера за месяц. */
export interface AnalyticsMasterWork {
  id: number;
  kind: 'refill' | 'part' | 'repair' | 'service';
  title: string;
  qty: number;
  amount: number | null;
  doneAt: string;
  orderId: number | null;
  orderNumber: string | null;
  deviceTitle: string | null;
  inventoryNo: string | null;
  clientId: number;
  clientName: string;
  partBrand: string | null;
  partSpec: string | null;
  warrantyMonths: number | null;
  ops: string[];
}

export interface AnalyticsMasterVisit {
  id: number;
  title: string;
  closedAt: string;
  clientId: number | null;
  clientName: string | null;
  checklistDone: number;
  checklistTotal: number;
  inspected: number;
}

export interface AnalyticsMasterDetail {
  userId: number;
  name: string;
  position: string | null;
  month: string;
  total: number;
  works: AnalyticsMasterWork[];
  visits: AnalyticsMasterVisit[];
}

export interface Analytics {
  month: string;
  compare: string;
  span: number;
  current: AnalyticsTotals;
  previous: AnalyticsTotals;
  trend: AnalyticsTrendPoint[];
  masters: AnalyticsMaster[];
  devices: AnalyticsDevice[];
  clients: AnalyticsClient[];
  early: EarlyReplacement[];
}

export interface ClientReport {
  clientId: number;
  clientName: string;
  kind: 'person' | 'legal';
  month: string;
  /** Те же итоги, что в строке отчёта. */
  totals: { accepted: number; repaired: number; declined: number; refills: number; visits: number };
  orders: ClientReportOrder[];
  /** Выезды за месяц: когда, кто и сколько пунктов чек-листа отмечено. */
  visits: ClientReportVisit[];
  /** Каждая заправка отдельной записью, с номером заявки. */
  refills: ClientReportWork[];
  /** Работы без заявки или по заявке не из этого месяца. */
  otherWorks: ClientReportWork[];
}

export interface MonthlyReport {
  month: string;
  rows: ReportRow[];
  totals: { all: ReportTotals; legal: ReportTotals; person: ReportTotals };
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

/** График регулярных выездов к клиенту. */
export interface ServicePlan {
  id: number;
  clientId: number;
  clientName: string;
  everyN: number;
  unit: 'week' | 'month';
  /** Дата следующего выезда, YYYY-MM-DD. */
  nextDate: string;
  visitTime: string | null;
  assigneeId: number;
  assigneeName: string;
  isActive: boolean;
  lastTaskId: number | null;
  /** Ближайшие даты по графику, начиная с nextDate. */
  upcoming?: string[];
}

export interface VisitsData {
  tasks: TaskListItem[];
  plans: ServicePlan[];
}
