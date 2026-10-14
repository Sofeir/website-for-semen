import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import type { Role } from '@sd/shared';
import { many, one, pool, tx, type Db } from './pool';
import { migrate } from './migrate';
import { APPEARANCE, DEVICE_TREE, FAULTS, KIT, SERVICES, STAGES, WARRANTIES } from './seedData';
import { DEFAULT_COMPANY, DEFAULT_WORK, setSetting } from '../services/settings';
import { Outbox } from '../notify/notify';
import { advanceOrder, createIntake, reassignOrder } from '../services/orders';
import { intakeSchema } from '@sd/shared';

/** Демо-приём идёт через ту же схему, что и запросы из формы. */
const intake = (db: Db, a: Actor, input: unknown, ob: Outbox) => createIntake(db, a, intakeSchema.parse(input), ob);
import { closeTasks, createTask, transferTask, type Actor } from '../services/tasks';
import { replaceFleet } from '../services/clients';
import { defaultDue } from '../services/workTime';

/** Справочники, этапы и настройки. Повторный запуск ничего не дублирует. */
export async function seedReference(db: Db = pool) {
  const has = await one('SELECT 1 FROM stages LIMIT 1', [], db);
  if (has) return false;

  for (const [i, s] of STAGES.entries()) {
    await db.query(`INSERT INTO stages (code, name, sort, color, sla_hours, is_final) VALUES ($1, $2, $3, $4, $5, $6)`, [
      s.code,
      s.name,
      (i + 1) * 10,
      s.color,
      s.sla,
      s.final,
    ]);
  }

  const typeIds = new Map<string, number>();
  for (const [ti, [type, brands]] of Object.entries(DEVICE_TREE).entries()) {
    const t = await one<{ id: number }>(
      'INSERT INTO device_types (name, sort) VALUES ($1, $2) RETURNING id',
      [type, (ti + 1) * 10],
      db,
    );
    typeIds.set(type, t!.id);
    for (const [bi, [brand, models]] of Object.entries(brands).entries()) {
      const b = await one<{ id: number }>(
        'INSERT INTO brands (device_type_id, name, sort) VALUES ($1, $2, $3) RETURNING id',
        [t!.id, brand, (bi + 1) * 10],
        db,
      );
      for (const [mi, model] of models.entries()) {
        await db.query('INSERT INTO models (brand_id, name, sort) VALUES ($1, $2, $3)', [b!.id, model, (mi + 1) * 10]);
      }
    }
  }

  for (const [type, faults] of Object.entries(FAULTS)) {
    const typeId = type === '*' ? null : typeIds.get(type);
    for (const [i, name] of faults.entries()) {
      await db.query('INSERT INTO faults (device_type_id, name, sort) VALUES ($1, $2, $3)', [
        typeId,
        name,
        (type === '*' ? 1000 : 0) + (i + 1) * 10,
      ]);
    }
  }

  for (const [i, name] of APPEARANCE.entries()) {
    await db.query(`INSERT INTO checklist_items (kind, name, sort) VALUES ('appearance', $1, $2)`, [name, (i + 1) * 10]);
  }
  for (const [i, name] of KIT.entries()) {
    await db.query(`INSERT INTO checklist_items (kind, name, sort) VALUES ('kit', $1, $2)`, [name, (i + 1) * 10]);
  }
  for (const [i, s] of SERVICES.entries()) {
    await db.query(`INSERT INTO services (name, price, price_from, device_type_id, sort) VALUES ($1, $2, $3, $4, $5)`, [
      s.name,
      s.price,
      Boolean(s.from),
      s.type ? typeIds.get(s.type) : null,
      (i + 1) * 10,
    ]);
  }
  for (const [i, w] of WARRANTIES.entries()) {
    await db.query(`INSERT INTO warranties (name, months, is_default, sort) VALUES ($1, $2, $3, $4)`, [
      w.name,
      w.months,
      w.def,
      i,
    ]);
  }

  await setSetting('work', DEFAULT_WORK, db);
  await setSetting(
    'company',
    {
      ...DEFAULT_COMPANY,
      site: 'old.2222717.ru',
      repeatDiscountText: 'При повторном обращении — скидка 10% на работы.',
    },
    db,
  );
  return true;
}

export const DEMO_USERS: { login: string; fullName: string; role: Role; phone?: string }[] = [
  { login: 'admin', fullName: 'Администратор', role: 'admin' },
  { login: 'semen', fullName: 'Семён', role: 'manager' },
  { login: 'stas', fullName: 'Стас', role: 'diagnostician' },
  { login: 'olga', fullName: 'Ольга', role: 'diagnostician' },
  { login: 'lenya', fullName: 'Лёня', role: 'master' },
];

export async function createUsers(password: string, db: Db = pool) {
  const hash = await bcrypt.hash(password, 10);
  for (const u of DEMO_USERS) {
    await db.query(
      `INSERT INTO users (login, password_hash, full_name, role, phone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (login) DO NOTHING`,
      [u.login, hash, u.fullName, u.role, u.phone ?? null],
    );
  }
}

async function actor(login: string): Promise<Actor> {
  const u = await one('SELECT id, role, full_name AS "fullName" FROM users WHERE login = $1', [login]);
  return u as Actor;
}

async function ids() {
  const types = new Map((await many('SELECT id, name FROM device_types')).map((r) => [r.name, r.id]));
  const brands = await many('SELECT id, name, device_type_id FROM brands');
  const models = await many('SELECT id, name, brand_id FROM models');
  const faults = await many('SELECT id, name, device_type_id FROM faults');
  const stages = new Map((await many('SELECT id, code FROM stages')).map((r) => [r.code, r.id]));
  return {
    type: (n: string) => types.get(n)!,
    brand: (t: string, n: string) => brands.find((b) => b.device_type_id === types.get(t) && b.name === n)!.id,
    model: (brandId: number, n: string) => models.find((m) => m.brand_id === brandId && m.name === n)?.id ?? null,
    fault: (n: string) => faults.find((f) => f.name === n)!.id,
    stage: (c: string) => stages.get(c)!,
  };
}

const daysAgo = (n: number, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** Живые демо-данные: клиенты, заявки на разных этапах, задачи, акт, чек-лист юрлица. */
export async function seedDemo() {
  const semen = await actor('semen');
  const stas = await actor('stas');
  const olga = await actor('olga');
  const lenya = await actor('lenya');
  const I = await ids();
  const ob = new Outbox();
  const due = (days: number) => defaultDue(DEFAULT_WORK, new Date(), days).toISOString();

  const laptop = (brand: string, model: string, serial: string) => {
    const brandId = I.brand('Ноутбук', brand);
    return { deviceTypeId: I.type('Ноутбук'), brandId, modelId: I.model(brandId, model), serial };
  };

  // 1. Диагностика у Стаса, срок сегодня.
  const r1 = await tx((db) =>
    intake(
      db,
      semen,
      {
        clientKind: 'person',
        newClient: { kind: 'person', name: 'Анна Смирнова', phone: '+7 912 345-67-89', email: 'anna.smirnova@example.ru' } as any,
        devices: [
          {
            device: laptop('Acer', 'Aspire 5', 'NXHN3ER00A1234567'),
            faultIds: [I.fault('Не включается')],
            faultText: 'После грозы перестал включаться, индикатор не горит',
            appearance: ['Потёртости', 'Царапины'],
            appearanceNote: null,
            kit: ['С ЗУ', 'Сумка или чехол'],
            kitNote: null,
            devicePassword: '1234',
            department: null,
          },
        ],
        responsibleId: stas.id,
        dueAt: due(0),
        comment: 'Клиент просит позвонить до начала ремонта',
        attachmentIds: [],
      },
      ob,
    ),
  );

  // 2. Принтер на согласовании у Семёна.
  const hp = I.brand('Принтеры/МФУ', 'HP');
  const r2 = await tx((db) =>
    intake(
      db,
      semen,
      {
        clientKind: 'person',
        newClient: { kind: 'person', name: 'Игорь Котов', phone: '89221112233' } as any,
        devices: [
          {
            device: {
              deviceTypeId: I.type('Принтеры/МФУ'),
              brandId: hp,
              modelId: I.model(hp, 'LaserJet Pro M404'),
              serial: 'PHBQ123456',
            },
            faultIds: [I.fault('Полосы при печати')],
            faultText: null,
            appearance: ['Загрязнения'],
            appearanceNote: null,
            kit: ['Кабель питания', 'USB-кабель', 'Картридж'],
            kitNote: null,
            devicePassword: null,
            department: null,
          },
        ],
        responsibleId: olga.id,
        dueAt: due(1),
        comment: null,
        attachmentIds: [],
      },
      ob,
    ),
  );
  await tx((db) =>
    advanceOrder(
      db,
      olga,
      r2.orderIds[0],
      {
        toStageId: I.stage('approval'),
        responsibleId: semen.id,
        dueAt: due(1),
        comment: 'Износ фьюзера. Замена — 3 500 ₽ с работой. Нужно согласие клиента.',
        estimatedCost: 3500,
      },
      ob,
    ),
  );

  // 3. Ноутбук в ремонте у Лёни, срок вчера — просрочка.
  const r3 = await tx((db) =>
    intake(
      db,
      semen,
      {
        clientKind: 'person',
        newClient: { kind: 'person', name: 'Мария Лебедева', phone: '+7 343 222-33-44' } as any,
        devices: [
          {
            device: laptop('Asus', 'VivoBook 15', 'M1NRKD012345'),
            faultIds: [I.fault('Разбит экран')],
            faultText: null,
            appearance: ['Трещины', 'Сколы'],
            appearanceNote: 'Трещина матрицы в левом верхнем углу',
            kit: ['Без ЗУ'],
            kitNote: null,
            devicePassword: null,
            department: null,
          },
        ],
        responsibleId: stas.id,
        dueAt: due(1),
        comment: null,
        attachmentIds: [],
      },
      ob,
    ),
  );
  const o3 = r3.orderIds[0];
  await tx((db) =>
    advanceOrder(
      db,
      stas,
      o3,
      {
        toStageId: I.stage('approval'),
        responsibleId: semen.id,
        dueAt: due(1),
        comment: 'Нужна матрица 15.6" 30 pin',
        estimatedCost: 6800,
      },
      ob,
    ),
  );
  await tx((db) =>
    advanceOrder(
      db,
      semen,
      o3,
      {
        toStageId: I.stage('repair'),
        responsibleId: lenya.id,
        dueAt: due(2),
        comment: 'Клиентка согласна, матрицу заказали',
        estimatedCost: null,
      },
      ob,
    ),
  );

  // 4. Готово к выдаче, с актом.
  const r4 = await tx((db) =>
    intake(
      db,
      semen,
      {
        clientKind: 'person',
        newClient: { kind: 'person', name: 'Дмитрий Орлов', phone: '+7 950 640-12-12' } as any,
        devices: [
          {
            device: laptop('Lenovo', 'Legion 5', 'PF2ABCDE'),
            faultIds: [I.fault('Перегревается, шумит')],
            faultText: 'В играх выключается',
            appearance: ['Без видимых дефектов'],
            appearanceNote: null,
            kit: ['С ЗУ'],
            kitNote: null,
            devicePassword: null,
            department: null,
          },
        ],
        responsibleId: stas.id,
        dueAt: due(1),
        comment: null,
        attachmentIds: [],
      },
      ob,
    ),
  );
  const o4 = r4.orderIds[0];
  await tx((db) =>
    advanceOrder(
      db,
      stas,
      o4,
      {
        toStageId: I.stage('approval'),
        responsibleId: semen.id,
        dueAt: due(1),
        comment: 'Чистка и замена термопасты',
        estimatedCost: 1000,
      },
      ob,
    ),
  );
  await tx((db) =>
    advanceOrder(
      db,
      semen,
      o4,
      { toStageId: I.stage('repair'), responsibleId: stas.id, dueAt: due(1), comment: null, estimatedCost: null },
      ob,
    ),
  );
  await tx((db) =>
    advanceOrder(
      db,
      stas,
      o4,
      {
        toStageId: I.stage('ready'),
        responsibleId: semen.id,
        dueAt: due(2),
        comment: 'Почистил, температуры в норме',
        estimatedCost: null,
      },
      ob,
    ),
  );
  const svc = await many('SELECT id, name, price FROM services');
  const service = (n: string) => svc.find((s) => s.name === n)!;
  const clean = service('Чистка от пыли с заменой термопасты');
  const seqAct = await one<{ n: number }>(`SELECT nextval('act_number_seq') AS n`);
  const act = await one(
    `INSERT INTO acts (number, order_id, warranty_months, print_repeat_discount, created_by, updated_by)
     VALUES (lpad($1::text, 6, '0'), $2, 1, false, $3, $3) RETURNING id`,
    [seqAct!.n, o4, stas.id],
  );
  await pool.query(
    `INSERT INTO act_items (act_id, service_id, name, qty, price, sort) VALUES ($1, $2, $3, 1, $4, 0), ($1, NULL, 'Термопрокладки', 1, 450, 1)`,
    [act.id, clean.id, clean.name, clean.price],
  );

  // 5. Юрлицо: два устройства одной квитанцией и чек-лист парка (60 ПК, 20 МФУ).
  const kyocera = I.brand('Принтеры/МФУ', 'Kyocera');
  const r5 = await tx((db) =>
    intake(
      db,
      semen,
      {
        clientKind: 'legal',
        newClient: {
          kind: 'legal',
          name: 'ООО «РБЕ Урал»',
          inn: '6671234567',
          kpp: '667101001',
          phone: '+7 343 300-20-10',
          contactPerson: 'Елена, бухгалтерия',
          address: 'Екатеринбург, ул. Малышева, 51',
        } as any,
        devices: [
          {
            device: {
              deviceTypeId: I.type('Принтеры/МФУ'),
              brandId: kyocera,
              modelId: I.model(kyocera, 'ECOSYS M2040dn'),
              serial: 'VCF8Z12345',
            },
            faultIds: [I.fault('Замятие бумаги')],
            faultText: null,
            appearance: ['Загрязнения'],
            appearanceNote: null,
            kit: ['Кабель питания'],
            kitNote: null,
            devicePassword: null,
            department: 'Бухгалтерия',
          },
          {
            device: {
              deviceTypeId: I.type('Компьютер'),
              brandId: I.brand('Компьютер', 'Сборка'),
              modelId: null,
              modelText: 'Офисный ПК, инв. P135',
              serial: null,
            },
            faultIds: [I.fault('Не загружается система')],
            faultText: null,
            appearance: ['Без видимых дефектов'],
            appearanceNote: null,
            kit: ['Кабель питания'],
            kitNote: null,
            devicePassword: 'admin / 2024',
            department: 'Общий зал',
          },
        ],
        responsibleId: olga.id,
        dueAt: due(1),
        comment: 'Выезд не нужен, привезли сами',
        attachmentIds: [],
        fleet: null,
      },
      ob,
    ),
  );
  const rbe = (await one('SELECT client_id FROM orders WHERE id = $1', [r5.orderIds[0]]))!.client_id;
  await tx((db) =>
    replaceFleet(db, rbe, [
      { department: 'Руководитель', pcCount: 3, mfuCount: 1, reserve: false, ssdCheck: true, note: null },
      { department: 'Бухгалтерия', pcCount: 12, mfuCount: 4, reserve: true, ssdCheck: true, note: '1С, ежедневный бэкап' },
      { department: 'Общий зал', pcCount: 40, mfuCount: 12, reserve: true, ssdCheck: false, note: null },
      { department: 'Склад', pcCount: 5, mfuCount: 3, reserve: false, ssdCheck: false, note: 'Старые ПК, плановая замена' },
    ]),
  );
  // Диагност передаёт МФУ мастеру.
  await tx((db) =>
    reassignOrder(
      db,
      olga,
      r5.orderIds[0],
      { responsibleId: lenya.id, dueAt: due(1), comment: 'Нужна замена ролика захвата, это к мастеру' },
      ob,
    ),
  );

  // 6. Выданная заявка — для истории клиента.
  const annaId = (await one('SELECT client_id FROM orders WHERE id = $1', [r1.orderIds[0]]))!.client_id;
  const samsung = I.brand('Телефон', 'Samsung');
  const r6 = await tx((db) =>
    intake(
      db,
      semen,
      {
        clientKind: 'person',
        clientId: annaId,
        newClient: null,
        devices: [
          {
            device: {
              deviceTypeId: I.type('Телефон'),
              brandId: samsung,
              modelId: I.model(samsung, 'Galaxy A52'),
              serial: 'R58R12ABCDE',
            },
            faultIds: [I.fault('Не заряжается')],
            faultText: null,
            appearance: ['Царапины'],
            appearanceNote: null,
            kit: [],
            kitNote: null,
            devicePassword: null,
            department: null,
          },
        ],
        responsibleId: stas.id,
        dueAt: due(1),
        comment: null,
        attachmentIds: [],
      },
      ob,
    ),
  );
  const o6 = r6.orderIds[0];
  for (const [code, who, by] of [
    ['approval', semen, stas],
    ['repair', stas, semen],
    ['ready', semen, stas],
    ['issued', semen, semen],
  ] as const) {
    await tx((db) =>
      advanceOrder(
        db,
        by,
        o6,
        {
          toStageId: I.stage(code),
          responsibleId: who.id,
          dueAt: due(1),
          comment: null,
          estimatedCost: code === 'approval' ? 1000 : null,
        },
        ob,
      ),
    );
  }

  // Отдельные задачи: обычная, просроченная и цепочка передачи.
  await tx((db) =>
    createTask(
      db,
      stas,
      {
        title: 'Позвонить Игорю Котову: согласовать замену фьюзера',
        description: 'Сумма 3 500 ₽ с работой',
        assigneeId: semen.id,
        orderId: r2.orderIds[0],
        clientId: null,
        startAt: new Date().toISOString(),
        dueAt: due(0),
        deadlineAt: null,
      },
      ob,
    ),
  );
  const chain = await tx((db) =>
    createTask(
      db,
      semen,
      {
        title: 'Проверить резервные ПК в РБЕ Урал',
        description: 'По чек-листу: отделы с отметкой «резервные»',
        assigneeId: stas.id,
        orderId: null,
        clientId: rbe,
        startAt: new Date().toISOString(),
        dueAt: due(1),
        deadlineAt: due(3),
      },
      ob,
    ),
  );
  await tx((db) =>
    transferTask(db, stas, chain, { assigneeId: lenya.id, dueAt: due(2), comment: 'Там нужна замена SSD, это к мастеру' }, ob),
  );
  const late = await tx((db) =>
    createTask(
      db,
      semen,
      {
        title: 'Заказать матрицу для Asus VivoBook 15',
        description: null,
        assigneeId: lenya.id,
        orderId: o3,
        clientId: null,
        startAt: daysAgo(3).toISOString(),
        dueAt: daysAgo(1, 18).toISOString(),
        deadlineAt: null,
      },
      ob,
    ),
  );
  const done = await tx((db) =>
    createTask(
      db,
      semen,
      {
        title: 'Обновить прайс на заправку картриджей',
        description: null,
        assigneeId: olga.id,
        orderId: null,
        clientId: null,
        startAt: daysAgo(2).toISOString(),
        dueAt: daysAgo(1, 18).toISOString(),
        deadlineAt: null,
      },
      ob,
    ),
  );
  await tx((db) => closeTasks(db, olga, [done], 'Цены обновлены в справочнике', ob));

  // Сдвигаем даты, чтобы были просрочки и история.
  await pool.query(`UPDATE tasks SET due_at = $2 WHERE id = $1`, [late, daysAgo(1, 18)]);
  await pool.query(`UPDATE orders SET stage_due_at = $2 WHERE id = $1`, [o3, daysAgo(1, 18)]);
  await pool.query(`UPDATE order_history SET due_at = $2 WHERE order_id = $1 AND finished_at IS NULL`, [o3, daysAgo(1, 18)]);
  await pool.query(
    `UPDATE task_steps SET due_at = $2 WHERE done_at IS NULL AND task_id IN (SELECT id FROM tasks WHERE order_id = $1)`,
    [o3, daysAgo(1, 18)],
  );
  await pool.query(`UPDATE tasks SET due_at = $2 WHERE order_id = $1 AND status = 'open'`, [o3, daysAgo(1, 18)]);
  await pool.query(`UPDATE orders SET created_at = $2, issued_at = $3 WHERE id = $1`, [o6, daysAgo(12), daysAgo(5)]);
  await pool.query(`UPDATE intake_batches SET created_at = $2 WHERE id = $1`, [r6.batchId, daysAgo(12)]);

  await ob.flush();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    await migrate();
    const created = await tx((db) => seedReference(db));
    console.log(created ? '✓ справочники заполнены' : '· справочники уже есть');
    const users = await one<{ n: number }>('SELECT count(*) AS n FROM users');
    if (!users?.n) {
      const password = process.env.SEED_PASSWORD;
      if (!password || password.length < 8) {
        throw new Error('Задайте SEED_PASSWORD (от 8 символов) в .env — это пароль демо-сотрудников');
      }
      await createUsers(password);
      await seedDemo();
      console.log(`✓ демо-данные: сотрудники ${DEMO_USERS.map((u) => u.login).join(', ')}`);
    } else {
      console.log('· сотрудники уже есть, демо-данные не трогаю');
    }
    await pool.end();
  })().catch(async (e) => {
    console.error(e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
}
