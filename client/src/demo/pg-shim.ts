// Замена пакета `pg` для демо: Postgres в WebAssembly (PGlite), данные хранятся в IndexedDB браузера.
import { PGlite } from '@electric-sql/pglite';

const DB_ID = 'asoft-demo-v1';

let dbPromise: Promise<PGlite> | null = null;
export function getDb() {
  dbPromise ??= PGlite.create(`idb://${DB_ID}`, {
    parsers: { 1700: (v: string) => Number(v), 20: (v: string) => Number(v) },
  });
  return dbPromise;
}

/** Стирает все данные демо; следующий запуск заполнит базу заново. */
export async function resetDb() {
  try {
    await (await getDb()).close();
  } catch {
    /* уже закрыта */
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(`/pglite/${DB_ID}`);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

type Result = { rows: any[]; rowCount: number };

async function run(text: string, params?: unknown[]): Promise<Result> {
  const db = await getDb();
  // Без параметров и с несколькими командами (миграции, BEGIN/COMMIT) — через exec.
  if (!params || params.length === 0) {
    const body = text.trim().replace(/;$/, '');
    if (/;/.test(body) || /^(BEGIN|COMMIT|ROLLBACK)$/i.test(body)) {
      const res = await db.exec(text);
      const last = res[res.length - 1];
      return { rows: last?.rows ?? [], rowCount: last?.affectedRows ?? last?.rows?.length ?? 0 };
    }
  }
  const r = await db.query(text, params as any[]);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
}

let txDepth = 0;
let lock: Promise<void> = Promise.resolve();

class Client {
  constructor(private done: () => void) {}
  query(text: string, params?: unknown[]) {
    return run(text, params);
  }
  release() {
    this.done();
  }
}

export class Pool {
  /** Транзакции идут по очереди: соединение у PGlite одно. */
  async connect() {
    let free!: () => void;
    const prev = lock;
    lock = new Promise<void>((r) => (free = r));
    await prev;
    txDepth++;
    return new Client(() => {
      txDepth--;
      free();
    });
  }
  async query(text: string, params?: unknown[]) {
    // Внутри транзакции запрос идёт тем же соединением, вне её — после текущей транзакции.
    if (!txDepth) await lock;
    return run(text, params);
  }
  async end() {}
}

export type PoolClient = Client;
export type QueryResultRow = Record<string, any>;
export const types = { setTypeParser() {} };
export default { Pool, types };
