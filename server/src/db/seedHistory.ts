import { formatOrderNumber, normalizePhone } from '@sd/shared';
import { one, many, tx } from './pool';

/**
 * Демо-история за год: заявки, работы с суммами, заправки, рабочие места, люди организаций, должности.
 * Нужна, чтобы страница «Аналитика» и журнал техники выглядели живыми. Суммы придуманы.
 * Можно вызывать повторно: если история уже есть, ничего не делает.
 *
 * Данные собираются в памяти и вставляются пачками: в браузере (PGlite) каждый запрос дорог,
 * поэтому сотни одиночных вставок делали первый запуск демо слишком долгим.
 */

/** Детерминированный генератор: одни и те же «случайные» числа при каждом запуске. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DAY = 86_400_000;
const when = (daysBack: number, hour = 11) => {
  const d = new Date(Date.now() - daysBack * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const FAULTS = [
  'Не включается',
  'Шумит и перегревается',
  'Не загружается система',
  'Полосы при печати',
  'Замятие бумаги',
  'Не видит жёсткий диск',
  'Медленно работает',
  'Разбит экран',
  'Не заряжается',
  'Нет изображения',
];

type Kind = 'laptop' | 'pc' | 'mfu';
interface Repair {
  title: string;
  part?: string;
  brand?: string;
  spec?: string;
  base: number;
  warranty?: number;
  /** Для какой техники подходит работа. */
  k: Kind[];
}
const REPAIRS: Repair[] = [
  { title: 'Чистка от пыли, замена термопасты', base: 1500, k: ['laptop', 'pc'] },
  { title: 'Переустановка системы', base: 1200, k: ['laptop', 'pc'] },
  { title: 'Замена SSD', part: 'SSD', brand: 'Kingston', spec: '480 ГБ', base: 4800, warranty: 12, k: ['laptop', 'pc'] },
  { title: 'Замена оперативной памяти', part: 'Оперативная память', brand: 'Samsung', spec: '8 ГБ DDR4', base: 3200, warranty: 12, k: ['laptop', 'pc'] },
  { title: 'Замена блока питания', part: 'Блок питания', brand: 'FSP', spec: '500 Вт', base: 3900, warranty: 12, k: ['pc'] },
  { title: 'Замена матрицы', part: 'Матрица', brand: 'LG', spec: '15.6" 30 pin', base: 8200, warranty: 6, k: ['laptop'] },
  { title: 'Замена клавиатуры', part: 'Клавиатура', brand: 'Logitech', spec: 'K120', base: 1100, warranty: 12, k: ['laptop'] },
  { title: 'Замена вентилятора охлаждения', part: 'Вентилятор', brand: 'Foxconn', spec: '80 мм', base: 1700, warranty: 6, k: ['laptop', 'pc'] },
  { title: 'Ремонт материнской платы', base: 6400, k: ['laptop', 'pc'] },
  { title: 'Замена ролика захвата бумаги', part: 'Ролик захвата', brand: 'HP', spec: 'RM2-5452', base: 2400, warranty: 6, k: ['mfu'] },
  { title: 'Замена термоузла (фьюзера)', part: 'Термоузел', brand: 'Kyocera', spec: 'FK-1150', base: 5200, warranty: 6, k: ['mfu'] },
  { title: 'Профилактика и чистка МФУ', base: 1800, k: ['mfu'] },
];
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней');

/** Марка и модель по типу техники, чтобы названия в демо выглядели правдоподобно. */
const MODELS: Record<string, [string, string][]> = {
  Ноутбук: [['Lenovo', 'IdeaPad 3'], ['Asus', 'VivoBook 15'], ['Acer', 'Aspire 5'], ['HP', 'ProBook 450'], ['Dell', 'Latitude 5420']],
  Компьютер: [['Сборка', 'Офисный ПК'], ['HP', 'ProDesk 400'], ['Dell', 'OptiPlex 3080'], ['Lenovo', 'ThinkCentre M70']],
  'Принтеры/МФУ': [['HP', 'LaserJet Pro M404'], ['Canon', 'i-SENSYS MF3010'], ['Kyocera', 'ECOSYS M2040dn'], ['Pantum', 'M6500']],
};

const REFILL_PRICE = { refill: 350, chip: 650, drum: 1800, roller: 450, blade: 300 } as const;

type Q = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Одна вставка на много строк: возвращает id в том же порядке, что и строки. */
async function bulk(q: Q, table: string, cols: string[], rows: unknown[][]): Promise<number[]> {
  const ids: number[] = [];
  // ограничение протокола: не больше 65535 параметров на запрос
  const per = Math.max(1, Math.floor(30000 / cols.length));
  for (let from = 0; from < rows.length; from += per) {
    const part = rows.slice(from, from + per);
    const params: unknown[] = [];
    const tuples = part.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(', ')})`);
    const res = await q(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} RETURNING id`, params);
    ids.push(...res.rows.map((x) => x.id as number));
  }
  return ids;
}

export async function seedHistory() {
  if (await one(`SELECT 1 FROM clients WHERE name = 'ООО «Уральские технологии»'`)) return;

  const users = new Map((await many('SELECT id, login FROM users')).map((u) => [u.login as string, u.id as number]));
  const need = ['semen', 'stas', 'olga', 'lenya', 'artem'];
  if (need.some((l) => !users.has(l))) return; // нет демо-сотрудников: история не нужна
  const U = (l: string) => users.get(l)!;
  const stages = new Map((await many('SELECT id, code FROM stages')).map((r) => [r.code as string, r.id as number]));
  const types = new Map((await many('SELECT id, name FROM device_types')).map((r) => [r.name as string, r.id as number]));
  if (!stages.size || !types.size) return;
  const rand = rng(20261020);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

  await tx(async (db) => {
    const q: Q = (text, params) => db.query(text, params);

    // Клиенты: две новые организации и один частный клиент (он же сотрудник РБЕ)
    const rbe = (await one<{ id: number }>(`SELECT id FROM clients WHERE name = 'ООО «РБЕ Урал»' LIMIT 1`))?.id ?? null;
    const persons = (await many(`SELECT id FROM clients WHERE kind = 'person' ORDER BY id`)).map((r) => r.id as number);
    const newClients = await bulk(
      q,
      'clients',
      ['kind', 'name', 'phone', 'phone_digits', 'inn', 'created_by'],
      [
        ['legal', 'ООО «Уральские технологии»', '+7 343 200-10-10', normalizePhone('+7 343 200-10-10'), '6671234567', U('semen')],
        ['legal', 'Кафе «Ямал»', '+7 343 211-22-33', normalizePhone('+7 343 211-22-33'), '6678901234', U('semen')],
        ['person', 'Давыдов Андрей Витальевич', '+7 900 100-20-30', normalizePhone('+7 900 100-20-30'), null, U('semen')],
      ],
    );
    const [org1, org2, davydovPerson] = newClients;
    const rbeId = rbe ?? org1;

    // Люди организаций
    const contactRows: [number, string, string, string | null, number | null][] = [
      [rbeId, 'Давыдов Андрей Витальевич', '+7 900 100-20-30', 'Бухгалтер', davydovPerson],
      [rbeId, 'Жукова Анна Сергеевна', '+7 900 100-20-31', 'Управляющая', null],
      [rbeId, 'Чувакова Ольга Анатольевна', '+7 900 100-20-32', null, null],
      [org1, 'Мельников Павел Игоревич', '+7 900 200-30-40', 'Директор', null],
      [org1, 'Рябова Светлана Олеговна', '+7 900 200-30-41', 'Офис-менеджер', null],
      [org2, 'Ким Артур Сергеевич', '+7 900 300-40-50', 'Администратор', null],
    ];
    const contactIds = await bulk(
      q,
      'client_contacts',
      ['client_id', 'full_name', 'phone', 'phone_digits', 'position', 'person_client_id'],
      contactRows.map((c) => [c[0], c[1], c[2], normalizePhone(c[2]), c[3], c[4]]),
    );
    const contactsOf = new Map<number, { id: number; name: string }[]>();
    contactRows.forEach((c, i) => contactsOf.set(c[0], [...(contactsOf.get(c[0]) ?? []), { id: contactIds[i], name: c[1] }]));

    // Парк организаций и рабочие места: системный блок, к нему монитор и клавиатура с мышью
    type Dev = { id: number; clientId: number; kind: 'pc' | 'laptop' | 'mfu' };
    const parents: { clientId: number; no: string; loc: string; monitor: string }[] = [
      { clientId: rbeId, no: 'ПК-054', loc: 'Бухгалтерия, каб. 12', monitor: 'Монитор Samsung 27"' },
      { clientId: rbeId, no: 'ПК-055', loc: 'Бухгалтерия, каб. 12', monitor: 'Монитор LG 24"' },
      { clientId: rbeId, no: 'ПК-061', loc: 'Общий зал, касса 2', monitor: 'Монитор AOC 22"' },
      { clientId: org1, no: 'ПК-101', loc: 'Офис, 2 этаж', monitor: 'Монитор Dell 24"' },
      { clientId: org2, no: 'ПК-201', loc: 'Зал, администратор', monitor: 'Монитор Acer 21"' },
    ];
    const DEV_COLS = ['client_id', 'device_type_id', 'brand_text', 'model_text', 'serial', 'inventory_no', 'location', 'parent_id'];
    const pcIds = await bulk(
      q,
      'devices',
      DEV_COLS,
      parents.map((p): unknown[] => [p.clientId, types.get('Компьютер'), 'Сборка', 'Офисный ПК', null, p.no, p.loc, null]),
    );
    await bulk(
      q,
      'devices',
      DEV_COLS,
      parents.flatMap((p, i): unknown[][] => [
        [p.clientId, types.get('Периферия'), '', p.monitor, null, null, p.loc, pcIds[i]],
        [p.clientId, types.get('Периферия'), 'Logitech', 'Клавиатура и мышь MK120', null, null, p.loc, pcIds[i]],
      ]),
    );
    const fleet: Dev[] = parents.map((p, i) => ({ id: pcIds[i], clientId: p.clientId, kind: 'pc' }));
    const pc54 = pcIds[0];

    const mfuDefs: [number, string, string, string, string, string][] = [
      [rbeId, 'HP', 'LaserJet Pro M404', 'PHBQ900111', 'МФУ-015', 'Общий зал'],
      [rbeId, 'Kyocera', 'ECOSYS M2040dn', 'VKX0912345', 'МФУ-016', 'Склад'],
      [org1, 'Canon', 'i-SENSYS MF3010', 'NGHA55512', 'МФУ-101', 'Офис, 2 этаж'],
    ];
    const mfuIds = await bulk(
      q,
      'devices',
      DEV_COLS,
      mfuDefs.map((d): unknown[] => [d[0], types.get('Принтеры/МФУ'), d[1], d[2], d[3], d[4], d[5], null]),
    );
    const mfus: Dev[] = mfuDefs.map((d, i) => ({ id: mfuIds[i], clientId: d[0], kind: 'mfu' }));
    fleet.push(...mfus);

    const laptopDefs: [number, string, string, string][] = [
      [org1, 'Lenovo', 'ThinkPad E14', 'PF3XYZ0001'],
      [org1, 'Asus', 'VivoBook 15', 'M1NRKD9001'],
      [rbeId, 'Dell', 'Latitude 5420', 'DL5420A777'],
    ];
    const laptopIds = await bulk(
      q,
      'devices',
      DEV_COLS,
      laptopDefs.map((d): unknown[] => [d[0], types.get('Ноутбук'), d[1], d[2], d[3], null, null, null]),
    );
    laptopDefs.forEach((d, i) => fleet.push({ id: laptopIds[i], clientId: d[0], kind: 'laptop' }));

    // Поток заявок за 11 месяцев: чем ближе к сегодня, тем больше. Всё считаем в памяти.
    const orgs = [rbeId, rbeId, rbeId, org1, org1, org2];
    const masters = ['lenya', 'stas'];
    const diags = ['stas', 'olga'];
    const stageId = (c: string) => stages.get(c)!;
    interface Plan {
      clientId: number;
      devRef: { id?: number; idx?: number };
      declined: boolean;
      finished: boolean;
      diag: string;
      master: string;
      created: Date;
      issuedAt: Date;
      contact: { id: number; name: string } | null;
      repair: Repair;
      sum: number;
      fault: string;
      reopen: boolean;
      extra: boolean;
    }
    const plans: Plan[] = [];
    const newDevices: unknown[][] = [];
    for (let i = 0; i < 96; i++) {
      const age = Math.floor(Math.pow(rand(), 1.6) * 330) + 2; // дней назад: к свежим датам плотнее
      const created = when(age, 9 + Math.floor(rand() * 8));
      const fromOrg = rand() < 0.72;
      const clientId = fromOrg ? pick(orgs) : pick(persons);
      const own = fleet.filter((d) => d.clientId === clientId);
      let devRef: Plan['devRef'];
      let kind: Kind;
      if (own.length && rand() < 0.7) {
        const d = pick(own);
        devRef = { id: d.id };
        kind = d.kind;
      } else {
        const t = pick(['Ноутбук', 'Компьютер', 'Принтеры/МФУ']);
        kind = t === 'Ноутбук' ? 'laptop' : t === 'Принтеры/МФУ' ? 'mfu' : 'pc';
        const serial = t === 'Компьютер' ? null : `DM${String(i).padStart(4, '0')}${Math.floor(rand() * 9000 + 1000)}`;
        const [brand, model] = pick(MODELS[t]);
        devRef = { idx: newDevices.length };
        newDevices.push([clientId, types.get(t), brand, model, serial, null, null, null]);
      }
      const declined = rand() < 0.14;
      const issuedAt = new Date(created.getTime() + (2 + Math.floor(rand() * 8)) * DAY);
      const repair = pick(REPAIRS.filter((r) => r.k.includes(kind)));
      plans.push({
        clientId,
        devRef,
        declined,
        finished: issuedAt.getTime() < Date.now(),
        diag: pick(diags),
        master: pick(masters),
        created,
        issuedAt,
        contact: contactsOf.get(clientId) ? pick(contactsOf.get(clientId)!) : null,
        repair,
        sum: Math.round((repair.base * (0.85 + rand() * 0.5)) / 50) * 50,
        fault: pick(FAULTS),
        reopen: rand() < 0.07,
        extra: rand() < 0.35,
      });
    }
    const createdDevices = await bulk(q, 'devices', DEV_COLS, newDevices);

    const plan_days = (p: Plan) => 2 + ((p.created.getDate() + p.sum / 50) % 5);
    const numbers = (await q(`SELECT nextval('order_number_seq') AS n FROM generate_series(1, $1::int)`, [plans.length])).rows.map(
      (r) => formatOrderNumber(Number(r.n)),
    );
    const devOf = (p: Plan) => (p.devRef.id ?? createdDevices[p.devRef.idx!]) as number;
    const orderIds = await bulk(
      q,
      'orders',
      [
        'number', 'client_id', 'device_id', 'stage_id', 'responsible_id', 'stage_started_at', 'fault_text', 'accepted_by',
        'created_at', 'updated_at', 'issued_at', 'device_returned_at', 'outcome', 'estimated_cost', 'requester_name', 'contact_id',
        'agreed_term', 'agreed_sum', 'reopen_count',
      ],
      plans.map((p, i) => [
        numbers[i],
        p.clientId,
        devOf(p),
        p.finished ? stageId('issued') : stageId('repair'),
        p.finished ? U('semen') : U(p.master),
        p.finished ? p.issuedAt : p.created,
        p.fault,
        U('semen'),
        p.created,
        p.created,
        p.finished ? p.issuedAt : null,
        p.finished ? p.issuedAt : null,
        p.finished ? (p.declined ? 'declined' : 'repaired') : null,
        p.sum,
        p.contact?.name ?? null,
        p.contact?.id ?? null,
        p.declined ? null : `${plan_days(p)} ${plural(plan_days(p))}`,
        p.declined ? null : p.sum,
        p.finished && !p.declined && p.reopen ? 1 : 0,
      ]),
    );

    // История этапов и записи работ одной пачкой
    const history: unknown[][] = [];
    const works: unknown[][] = [];
    const hrs = (p: Plan, h: number) => new Date(p.created.getTime() + h * 3_600_000);
    const pre = (p: Plan) => new Date(p.issuedAt.getTime() - 4 * 3_600_000);
    plans.forEach((p, i) => {
      const o = orderIds[i];
      const row = (kind: string, stage: string, who: string, at: Date, to: Date | null, comment: string | null, outcome: string | null = null) =>
        history.push([o, kind, stageId(stage), U(who), at, to, comment, outcome]);
      row('stage', 'intake', 'semen', p.created, hrs(p, 1), 'Техника принята');
      row('stage', 'diagnostics', p.diag, hrs(p, 1), hrs(p, 20), null);
      row('stage', 'approval', 'semen', hrs(p, 20), hrs(p, 30), p.declined ? 'Клиент отказался от ремонта' : 'Согласовано');
      if (!p.declined) row('stage', 'repair', p.master, hrs(p, 30), pre(p), null);
      if (p.finished) {
        row('stage', 'ready', 'semen', pre(p), p.issuedAt, null, p.declined ? 'declined' : 'repaired');
        row('stage', 'issued', 'semen', p.issuedAt, null, null);
      }
      if (p.finished && !p.declined) {
        const doneAt = new Date(p.issuedAt.getTime() - 5 * 3_600_000);
        works.push([
          p.clientId, devOf(p), o, p.repair.part ? 'part' : 'repair', p.repair.title, 1, doneAt, U(p.master), U(p.master), p.sum,
          p.repair.brand ?? null, p.repair.spec ?? null, p.repair.warranty ?? null, null, null, [],
        ]);
        if (p.extra) works.push([p.clientId, devOf(p), o, 'service', 'Диагностика, чистка', 1, doneAt, U(p.diag), U(p.diag), 500, null, null, null, null, null, []]);
        if (p.reopen) {
          row('reopen', 'diagnostics', p.diag, new Date(p.issuedAt.getTime() + 20 * DAY), null, 'Гарантия: снова не работает');
        }
      }
    });
    await bulk(q, 'order_history', ['order_id', 'kind', 'stage_id', 'responsible_id', 'started_at', 'finished_at', 'comment', 'outcome'], history);

    // Заправки идут по заявке: берём заявку клиента, ближайшую по дате (заявки заводят до работы, поэтому не позже даты)
    const orderFor = (clientId: number, at: Date): number | null => {
      let best: number | null = null;
      let bestGap = Infinity;
      plans.forEach((p, i) => {
        if (p.clientId !== clientId) return;
        const gap = at.getTime() - p.created.getTime();
        if (gap >= 0 && gap < bestGap) {
          best = orderIds[i];
          bestGap = gap;
        }
      });
      return best;
    };
    // Заправки: у организаций каждый месяц, у частных реже
    for (let m = 0; m < 11; m++) {
      for (const [clientId, base] of [[rbeId, 10], [org1, 4], [org2, 3]] as const) {
        const qty = Math.round(base * (0.7 + rand() * 0.8)) || 1;
        const ops = pick([['refill'], ['refill'], ['refill', 'chip'], ['refill', 'drum'], ['refill', 'roller']]) as string[];
        const price = ops.reduce((s, o) => s + REFILL_PRICE[o as keyof typeof REFILL_PRICE], 0);
        const at = when(m * 30 + 3 + Math.floor(rand() * 20), 14);
        works.push([
          clientId, null, orderFor(clientId, at), 'refill', pick(['Картридж CF259A', 'Картридж CE505A', 'Картридж 725']), qty,
          at, U('olga'), U('olga'), qty * price, null, null, null, null, null, ops,
        ]);
      }
    }
    for (const c of persons.slice(0, 3)) {
      const at = when(20 + Math.floor(rand() * 200));
      works.push([c, null, orderFor(c, at), 'refill', 'Картридж CE285A', 2, at, U('olga'), U('olga'), 800, null, null, null, null, null, ['refill']]);
    }

    // Журнал МФУ с ресурсом детали: замена раньше расчётного срока
    const drum = (m: Dev, counter: number, daysBack: number, by: string) =>
      works.push([m.clientId, m.id, null, 'part', 'Блок фотобарабана', 1, when(daysBack), U(by), U(by), 6800, 'HP', 'CF259A', 6, counter, 150000, []]);
    drum(mfus[0], 40000, 300, 'lenya');
    drum(mfus[0], 120000, 140, 'lenya');
    drum(mfus[1], 55000, 220, 'lenya');
    drum(mfus[1], 205000, 30, 'lenya');

    // Замены на рабочем месте ПК-054 с гарантией
    for (const [title, brand, spec, daysBack, amount, by] of [
      ['Оперативная память', 'Kingston', '8 ГБ DDR4', 150, 3300, 'stas'],
      ['Блок питания', 'FSP', '500 Вт', 60, 3900, 'lenya'],
    ] as const) {
      works.push([rbeId, pc54, null, 'part', title, 1, when(daysBack), U(by), U(by), amount, brand, spec, 12, null, null, []]);
    }
    const WORK_COLS = [
      'client_id', 'device_id', 'order_id', 'kind', 'title', 'qty', 'done_at', 'created_by', 'performer_id', 'amount',
      'part_brand', 'part_spec', 'warranty_months', 'counter', 'resource', 'ops',
    ];
    await bulk(q, 'device_works', WORK_COLS, works);

    // Уже заведённые демо-работы: суммы, исполнители и ресурс
    await q(`UPDATE device_works SET performer_id = created_by WHERE performer_id IS NULL`);
    await q(`UPDATE device_works SET amount = CASE kind WHEN 'part' THEN 6800 WHEN 'refill' THEN qty * 420 ELSE 1500 END WHERE amount IS NULL`);
    await q(`UPDATE device_works SET resource = 150000 WHERE resource IS NULL AND title = 'Блок фотобарабана'`);
    await q(`UPDATE device_works SET ops = '{refill}' WHERE kind = 'refill' AND ops = '{}'`);
  });
}

/**
 * Демо-выезды за год: закрытые задачи-выезды с чек-листом, чтобы выезды были видны в отчётах и аналитике.
 * Идемпотентно: если закрытые выезды старше двух недель уже есть, ничего не делает.
 */
export async function seedVisitHistory() {
  if (await one(`SELECT 1 FROM tasks WHERE is_visit AND status = 'done' AND closed_at < now() - interval '15 days'`)) return;
  const users = new Map((await many('SELECT id, login FROM users')).map((u) => [u.login as string, u.id as number]));
  if (['semen', 'stas', 'lenya', 'artem'].some((l) => !users.has(l))) return;
  const orgs = await many<{ id: number; name: string }>(
    `SELECT id, name FROM clients WHERE name IN ('ООО «РБЕ Урал»', 'ООО «Уральские технологии»', 'Кафе «Ямал»')`,
  );
  if (!orgs.length) return;
  const rand = rng(20261024);
  const crew = [users.get('lenya')!, users.get('stas')!, users.get('artem')!];
  const works = ['Проверить резервное копирование', 'Проверить диски (SMART)', 'Почистить системные блоки от пыли', 'Проверить МФУ: печать и сканирование', 'Обновить антивирус'];
  await tx(async (db) => {
    let n = 0;
    for (const org of orgs) {
      // РБЕ ездим каждый месяц, остальных реже
      const every = org.name.includes('РБЕ') ? 1 : org.name.includes('Уральские') ? 2 : 3;
      for (let m = 0; m < 12; m += every) {
        const at = when(m * 30 + 2 + Math.floor(rand() * 22), 12);
        const who = crew[n++ % crew.length];
        const t = await db.query(
          `INSERT INTO tasks (title, creator_id, assignee_id, client_id, start_at, due_at, status, closed_at, closed_by, is_visit)
           VALUES ($1, $2, $3, $4, $5, $5, 'done', $5, $3, true) RETURNING id`,
          [`Выезд: ${org.name}`, users.get('semen')!, who, org.id, at],
        );
        for (const [i, title] of works.entries()) {
          const done = rand() > 0.12;
          await db.query(
            `INSERT INTO task_checklist_items (task_id, title, sort, done, done_at, done_by) VALUES ($1, $2, $3, $4, $5, $6)`,
            [t.rows[0].id, title, (i + 1) * 10, done, done ? at : null, done ? who : null],
          );
        }
      }
    }
  });
}
