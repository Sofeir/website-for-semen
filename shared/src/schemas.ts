import { z } from 'zod';
import { STAFF_ROLES } from './roles';

const text = (max = 255) => z.string().trim().max(max);
/** Необязательный текст: пустая строка превращается в null. */
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const id = z.coerce.number().int().positive();
const optionalId = z.preprocess(
  (v) => (v === '' || v === 0 || v === '0' ? null : v),
  z.coerce.number().int().positive().optional().nullable(),
);
export const isoDate = z.string().datetime({ offset: true, message: 'Укажите дату и время' });

// ---------- Вход ----------

export const loginSchema = z.object({
  login: text(64).min(1, 'Введите логин'),
  password: z.string().min(1, 'Введите пароль').max(200),
  remember: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- Клиенты ----------

export const CLIENT_KINDS = ['person', 'legal'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
export const CLIENT_KIND_LABELS: Record<ClientKind, string> = { person: 'Физлицо', legal: 'Юрлицо' };

export const clientSchema = z
  .object({
    kind: z.enum(CLIENT_KINDS),
    name: text(200).min(2, 'Укажите имя или название'),
    phone: optionalText(32),
    phone2: optionalText(32),
    email: z
      .union([z.literal(''), z.string().trim().email('Проверьте почту').max(200)])
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    address: optionalText(300),
    inn: z
      .string()
      .trim()
      .regex(/^(\d{10}|\d{12})?$/, 'ИНН — 10 или 12 цифр')
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    kpp: z
      .string()
      .trim()
      .regex(/^(\d{9})?$/, 'КПП — 9 цифр')
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    contactPerson: optionalText(200),
    note: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    const digits = (v.phone || '').replace(/\D/g, '');
    if (v.kind === 'person' && (digits.length < 10 || digits.length > 11)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Телефон: 10–11 цифр' });
    }
    if (v.kind === 'legal' && !v.contactPerson) {
      ctx.addIssue({ code: 'custom', path: ['contactPerson'], message: 'Кто контактное лицо?' });
    }
  });
export type ClientInput = z.infer<typeof clientSchema>;

// ---------- Приём ----------

export const deviceSchema = z.object({
  id: optionalId,
  deviceTypeId: id,
  brandId: optionalId,
  brandText: optionalText(100),
  modelId: optionalId,
  modelText: optionalText(150),
  serial: optionalText(100),
});
export type DeviceInput = z.infer<typeof deviceSchema>;

export const intakeDeviceSchema = z.object({
  device: deviceSchema,
  faultIds: z.array(id).max(20).default([]),
  faultText: optionalText(1000),
  appearance: z.array(text(100)).max(40).default([]),
  appearanceNote: optionalText(500),
  kit: z.array(text(100)).max(40).default([]),
  kitNote: optionalText(500),
  devicePassword: optionalText(200),
  department: optionalText(120),
});
export type IntakeDeviceInput = z.infer<typeof intakeDeviceSchema>;

export const fleetRowSchema = z.object({
  department: text(120).min(1, 'Отдел'),
  pcCount: z.coerce.number().int().min(0).max(100000),
  mfuCount: z.coerce.number().int().min(0).max(100000),
  reserve: z.boolean().default(false),
  ssdCheck: z.boolean().default(false),
  note: optionalText(500),
});
export const fleetSchema = z.object({ rows: z.array(fleetRowSchema).max(200) });
export type FleetRow = z.infer<typeof fleetRowSchema>;

export const intakeSchema = z
  .object({
    clientKind: z.enum(CLIENT_KINDS),
    clientId: optionalId,
    newClient: clientSchema.optional().nullable(),
    devices: z.array(intakeDeviceSchema).min(1, 'Добавьте технику').max(30),
    responsibleId: id,
    dueAt: isoDate,
    comment: optionalText(2000),
    attachmentIds: z.array(id).max(20).default([]),
    fleet: z.array(fleetRowSchema).max(200).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.clientId && !v.newClient) {
      ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Выберите или создайте клиента' });
    }
    v.devices.forEach((d, i) => {
      if (!d.faultIds.length && !d.faultText) {
        ctx.addIssue({ code: 'custom', path: ['devices', i, 'faultText'], message: 'Опишите неисправность' });
      }
    });
  });
export type IntakeInput = z.infer<typeof intakeSchema>;

// ---------- Заявки ----------

export const advanceOrderSchema = z.object({
  toStageId: id,
  responsibleId: id,
  dueAt: isoDate.optional().nullable(),
  comment: optionalText(2000),
  estimatedCost: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
});
export type AdvanceOrderInput = z.infer<typeof advanceOrderSchema>;

export const reassignOrderSchema = z.object({
  responsibleId: id,
  dueAt: isoDate.optional().nullable(),
  comment: optionalText(2000),
});
export type ReassignOrderInput = z.infer<typeof reassignOrderSchema>;

// ---------- Задачи ----------

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskSchema = z
  .object({
    title: text(200).min(2, 'Назовите задачу'),
    description: optionalText(4000),
    assigneeId: id,
    orderId: optionalId,
    clientId: optionalId,
    startAt: isoDate,
    dueAt: isoDate,
    deadlineAt: isoDate.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (new Date(v.dueAt) < new Date(v.startAt)) {
      ctx.addIssue({ code: 'custom', path: ['dueAt'], message: 'Срок раньше начала' });
    }
    if (v.deadlineAt && new Date(v.deadlineAt) < new Date(v.dueAt)) {
      ctx.addIssue({ code: 'custom', path: ['deadlineAt'], message: 'Крайний срок раньше срока' });
    }
  });
export type TaskInput = z.infer<typeof taskSchema>;

export const closeTasksSchema = z.object({
  ids: z.array(id).min(1, 'Отметьте задачи').max(200),
  comment: optionalText(2000),
});
export type CloseTasksInput = z.infer<typeof closeTasksSchema>;

export const transferTaskSchema = z.object({
  assigneeId: id,
  dueAt: isoDate,
  comment: optionalText(2000),
});
export type TransferTaskInput = z.infer<typeof transferTaskSchema>;

// ---------- Акты ----------

export const actItemSchema = z.object({
  serviceId: optionalId,
  name: text(300).min(1, 'Название работы'),
  qty: z.coerce.number().positive('Больше нуля').max(10000),
  price: z.coerce.number().min(0, 'Не меньше нуля').max(10_000_000),
});

export const actSchema = z.object({
  orderId: id,
  items: z.array(actItemSchema).min(1, 'Добавьте хотя бы одну работу').max(100),
  warrantyMonths: z.coerce.number().int().min(0).max(60),
  printRepeatDiscount: z.boolean().default(false),
  note: optionalText(2000),
});
export type ActInput = z.infer<typeof actSchema>;

// ---------- Пользователи и профиль ----------

export const userCreateSchema = z.object({
  login: z
    .string()
    .trim()
    .min(3, 'Минимум 3 символа')
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Латиница, цифры, точка, дефис'),
  fullName: text(120).min(2, 'Имя и фамилия'),
  role: z.enum(STAFF_ROLES),
  phone: optionalText(32),
  password: z.string().min(8, 'Пароль от 8 символов').max(200),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  fullName: text(120).min(2).optional(),
  role: z.enum(STAFF_ROLES).optional(),
  roleConfirmed: z.boolean().optional(),
  phone: optionalText(32),
  isActive: z.boolean().optional(),
  password: z.union([z.literal(''), z.string().min(8, 'Пароль от 8 символов').max(200)]).optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

// ---------- Заказчик ----------

/** Самостоятельная регистрация заказчика. Доступ открывает руководитель после проверки. */
export const registerSchema = z.object({
  kind: z.enum(CLIENT_KINDS),
  fullName: text(120).min(2, 'Укажите имя или название организации'),
  contactPerson: optionalText(120),
  phone: text(32).min(6, 'Укажите телефон для связи'),
  email: optionalText(120),
  login: z
    .string()
    .trim()
    .min(3, 'Минимум 3 символа')
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Латиница, цифры, точка, дефис'),
  password: z.string().min(8, 'Пароль от 8 символов').max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Задача от заказчика. Исполнителя и срок по умолчанию выбирает система. */
export const customerTaskSchema = z.object({
  title: text(200).min(2, 'Опишите, что нужно сделать'),
  description: optionalText(4000),
  dueAt: isoDate.optional().nullable(),
});
export type CustomerTaskInput = z.infer<typeof customerTaskSchema>;

export const profileSchema = z.object({
  notifyInApp: z.boolean(),
  notifyTelegram: z.boolean(),
  notifyMax: z.boolean(),
  telegramChatId: optionalText(64),
  maxUserId: optionalText(64),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const changePasswordSchema = z.object({
  current: z.string().min(1, 'Текущий пароль'),
  next: z.string().min(8, 'Пароль от 8 символов').max(200),
});

// ---------- Справочники и настройки ----------

export const DICTIONARIES = [
  'device_types',
  'brands',
  'models',
  'faults',
  'appearance',
  'kit',
  'services',
  'warranties',
  'stages',
] as const;
export type DictionaryName = (typeof DICTIONARIES)[number];

export const STAGE_COLORS = ['sky', 'violet', 'amber', 'blue', 'teal', 'slate'] as const;

export const dictionaryItemSchema = z.object({
  name: text(200).min(1, 'Название'),
  sort: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  parentId: optionalId,
  price: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  priceFrom: z.boolean().optional(),
  months: z.coerce.number().int().min(0).max(60).optional(),
  isDefault: z.boolean().optional(),
  color: z.enum(STAGE_COLORS).optional(),
  slaHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
});
export type DictionaryItemInput = z.infer<typeof dictionaryItemSchema>;

export const companySettingsSchema = z.object({
  name: text(200).min(1, 'Название'),
  legalName: text(300).default(''),
  inn: text(12).default(''),
  kpp: text(9).default(''),
  ogrn: text(15).default(''),
  address: text(300).default(''),
  phone: text(64).default(''),
  email: text(200).default(''),
  site: text(200).default(''),
  workHours: text(200).default(''),
  receiptTerms: z.string().max(6000).default(''),
  actTerms: z.string().max(6000).default(''),
  repeatDiscountText: z.string().max(500).default(''),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const workSettingsSchema = z
  .object({
    workStart: z.string().regex(/^\d{2}:\d{2}$/, 'ЧЧ:ММ'),
    workEnd: z.string().regex(/^\d{2}:\d{2}$/, 'ЧЧ:ММ'),
    workDays: z.array(z.number().int().min(1).max(7)).min(1, 'Хотя бы один день'),
    defaultDueDays: z.coerce.number().int().min(0).max(30),
  })
  .refine((v) => v.workStart < v.workEnd, { path: ['workEnd'], message: 'Конец раньше начала' });
export type WorkSettings = z.infer<typeof workSettingsSchema>;

export const IMPORT_FIELDS = {
  name: 'Имя / название',
  phone: 'Телефон',
  phone2: 'Доп. телефон',
  email: 'Почта',
  address: 'Адрес',
  inn: 'ИНН',
  contactPerson: 'Контактное лицо',
  note: 'Заметка',
  deviceType: 'Тип техники',
  brand: 'Марка',
  model: 'Модель',
  serial: 'Серийный номер',
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

export const importCommitSchema = z.object({
  token: z.string().min(10).max(100),
  kind: z.enum(CLIENT_KINDS),
  /** поле системы → индекс колонки файла */
  mapping: z.record(z.string(), z.coerce.number().int().min(0).max(500)),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
