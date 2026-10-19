/** Справочники из ТЗ (п.11) и стартовые значения. Меняются потом в «Справочниках». */

export const STAGES = [
  { code: 'intake', name: 'Приём', color: 'sky', sla: 1, final: false },
  { code: 'diagnostics', name: 'Диагностика', color: 'violet', sla: 24, final: false },
  { code: 'approval', name: 'Согласование', color: 'amber', sla: 24, final: false },
  { code: 'repair', name: 'Ремонт', color: 'blue', sla: 72, final: false },
  { code: 'ready', name: 'Готово', color: 'teal', sla: 72, final: false },
  { code: 'issued', name: 'Выдача', color: 'slate', sla: 1, final: true },
];

/** Тип техники → марки → модели (модели — только самые частые, остальное вводят вручную). */
export const DEVICE_TREE: Record<string, Record<string, string[]>> = {
  Компьютер: { Сборка: [], HP: [], Dell: [], Lenovo: [], Acer: [] },
  Ноутбук: {
    MacBook: ['Air 13 M1', 'Pro 14'],
    Acer: ['Aspire 5', 'Swift 3', 'Nitro 5'],
    Asus: ['VivoBook 15', 'ZenBook 14', 'TUF Gaming F15'],
    Dell: ['Inspiron 15', 'Latitude 5420'],
    Sony: ['Vaio'],
    HP: ['Pavilion 15', 'ProBook 450', '250 G8'],
    Samsung: ['Galaxy Book'],
    Toshiba: ['Satellite'],
    Lenovo: ['IdeaPad 3', 'ThinkPad E14', 'Legion 5'],
    MSI: ['Modern 15', 'Katana GF66'],
  },
  Планшет: { Samsung: ['Galaxy Tab A8'], Lenovo: ['Tab M10'], Huawei: ['MatePad'], Xiaomi: ['Pad 6'] },
  Телефон: { Samsung: ['Galaxy A52', 'Galaxy S21'], Xiaomi: ['Redmi Note 12'], Honor: ['X8'], Huawei: [], Realme: [] },
  Apple: { iPhone: ['iPhone 12', 'iPhone 13', 'iPhone 14'], iPad: [], iMac: [], 'Apple Watch': [] },
  Телевизор: { Samsung: [], LG: [], Sony: [], Philips: [], Xiaomi: [], TCL: [], Haier: [] },
  'Принтеры/МФУ': {
    HP: ['LaserJet Pro M404', 'LaserJet 1018'],
    Canon: ['i-SENSYS MF3010'],
    Epson: ['L3150'],
    Brother: ['DCP-L2500'],
    Kyocera: ['ECOSYS M2040dn', 'ECOSYS P2335d'],
    Pantum: ['M6500'],
    Xerox: [],
  },
  Периферия: { Logitech: [], A4Tech: [], Defender: [], Genius: [] },
  Мониторы: { Samsung: [], LG: [], Dell: [], AOC: [], Philips: [], Acer: [], Asus: [] },
  'Игровая приставка': { 'Sony PlayStation': ['PS4', 'PS5'], 'Microsoft Xbox': ['Series S', 'One'], Nintendo: ['Switch'] },
  Моноблок: { Lenovo: [], HP: [], Asus: [], Acer: [] },
  Картридж: { HP: [], Canon: [], Kyocera: [], Pantum: [], Brother: [] },
  Фотоаппараты: { Canon: [], Nikon: [], Sony: [], Fujifilm: [] },
  Брелоки: { StarLine: [], Pandora: [], Шериф: [] },
};

/** null — неисправность подходит к любой технике. */
export const FAULTS: Record<string, string[]> = {
  '*': ['Не включается', 'Механическое повреждение', 'Попадание жидкости', 'Нужна диагностика'],
  Ноутбук: [
    'Не заряжается',
    'Перегревается, шумит',
    'Разбит экран',
    'Нет изображения',
    'Не работает клавиатура',
    'Сломан разъём питания',
    'Медленно работает',
    'Не загружается система',
  ],
  Компьютер: ['Не загружается система', 'Перегревается, шумит', 'Синий экран', 'Медленно работает'],
  Моноблок: ['Не загружается система', 'Нет изображения', 'Перегревается, шумит'],
  Планшет: ['Разбит экран', 'Не заряжается', 'Быстро садится батарея'],
  Телефон: ['Разбит экран', 'Не заряжается', 'Быстро садится батарея', 'Не работает камера', 'Нет связи'],
  Apple: ['Разбит экран', 'Не заряжается', 'Быстро садится батарея', 'Не работает Face ID'],
  'Принтеры/МФУ': ['Не печатает', 'Полосы при печати', 'Замятие бумаги', 'Нужна заправка', 'Ошибка на дисплее'],
  Картридж: ['Нужна заправка', 'Печатает бледно'],
  Мониторы: ['Нет изображения', 'Полосы на экране', 'Мерцает'],
  Телевизор: ['Нет изображения', 'Полосы на экране', 'Нет звука'],
  'Игровая приставка': ['Перегревается, шумит', 'Не читает диски', 'Не работает геймпад'],
  Фотоаппараты: ['Не фокусируется', 'Ошибка объектива'],
  Периферия: ['Не работает кнопка', 'Не определяется'],
  Брелоки: ['Не реагирует', 'Нужна замена батарейки'],
};

export const APPEARANCE = [
  'Без видимых дефектов',
  'Царапины',
  'Потёртости',
  'Загрязнения',
  'Сколы',
  'Трещины',
  'Вмятины',
  'Следы жидкости',
  'Следы вскрытия',
  'Нет винтов',
];

export const KIT = [
  'Без ЗУ',
  'С ЗУ',
  'Без кабеля питания',
  'Кабель питания',
  'Сумка или чехол',
  'USB-кабель',
  'Аккумулятор',
  'Картридж',
  'Коробка',
  'Документы',
];

/** Стартовый прайс со старого сайта (ТЗ, п.11). Цены «от» помечены priceFrom. */
export const SERVICES: { name: string; price: number; from?: boolean; type?: string }[] = [
  { name: 'Диагностика', price: 0 },
  { name: 'Замена видеочипа', price: 1500, from: true, type: 'Ноутбук' },
  { name: 'Замена матрицы', price: 800, from: true, type: 'Ноутбук' },
  { name: 'Замена северного или южного моста', price: 1500, from: true, type: 'Ноутбук' },
  { name: 'Корпусной ремонт', price: 500, from: true },
  { name: 'Прошивка BIOS', price: 1000 },
  { name: 'Замена разъёма питания, USB, LAN или audio', price: 1000 },
  { name: 'Ремонт цепей питания', price: 1000 },
  { name: 'Чистка платы после попадания жидкости', price: 500 },
  { name: 'Чистка от пыли с заменой термопасты', price: 1000 },
  { name: 'Заправка картриджа', price: 280, from: true, type: 'Картридж' },
  { name: 'Ремонт принтера', price: 200, from: true, type: 'Принтеры/МФУ' },
  { name: 'Техническое обслуживание принтера', price: 500, from: true, type: 'Принтеры/МФУ' },
];

export const WARRANTIES = [
  { name: 'Без гарантии', months: 0, def: false },
  { name: '1 месяц', months: 1, def: true },
  { name: '3 месяца', months: 3, def: false },
  { name: '6 месяцев', months: 6, def: false },
  { name: '12 месяцев', months: 12, def: false },
];
