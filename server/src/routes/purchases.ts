import { Router } from 'express';
import { can, purchaseSchema, purchaseStepSchema, type PurchaseClientHit, type PurchaseDetail, type PurchaseEvent, type PurchaseItem } from '@sd/shared';
import { many, one, pool, tx, type Db } from '../db/pool';
import { forbidden, h, HttpError, intParam, parse } from '../lib/http';
import { Outbox } from '../notify/notify';
import { likeEscape } from '../services/sql';

export const purchasesRouter = Router();

type Actor = { id: number; role: Parameters<typeof can>[0]; fullName: string };

interface PurchaseRow {
  id: number;
  status: PurchaseItem['status'];
  title: string;
  creator_id: number;
  buyer_id: number;
}

/** Следующий шаг закупки и тот, кто его делает. */
const NEXT_STATUS = { approval: 'buying', buying: 'delivery', delivery: 'done' } as const;

const SELECT = `
  SELECT p.id, p.title, p.client_id AS "clientId", c.name AS "clientName", p.comment, p.status,
         p.creator_id AS "creatorId", cu.full_name AS "creatorName", p.buyer_id AS "buyerId", bu.full_name AS "buyerName",
         p.created_at AS "createdAt", p.updated_at AS "updatedAt"
    FROM purchases p
    LEFT JOIN clients c ON c.id = p.client_id
    JOIN users cu ON cu.id = p.creator_id
    JOIN users bu ON bu.id = p.buyer_id`;

const approves = (role: Actor['role']) => can(role, 'purchases.approve');

/** Следующий шаг за сотрудником: согласовать (директор), купить или отвезти (покупатель или директор). */
function waitingFor(p: Pick<PurchaseRow, 'status' | 'buyer_id'>, user: Actor) {
  if (p.status === 'approval') return approves(user.role);
  if (p.status === 'buying' || p.status === 'delivery') return p.buyer_id === user.id || approves(user.role);
  return false;
}

function visibleTo(p: Pick<PurchaseRow, 'creator_id' | 'buyer_id'>, user: Actor) {
  return approves(user.role) || p.creator_id === user.id || p.buyer_id === user.id;
}

async function activeUser(db: Db, id: number) {
  const u = await one<{ id: number }>('SELECT id FROM users WHERE id = $1 AND is_active AND role <> $2', [id, 'customer'], db);
  if (!u) throw new HttpError(400, 'Выберите сотрудника из списка');
  return u.id;
}

/** Кого просим согласовать: директора с отметкой «подтверждает просрочки», а если такого нет, всех, кто согласует. */
async function approverIds(db: Db): Promise<number[]> {
  const marked = await many<{ id: number }>(`SELECT id FROM users WHERE is_active AND confirms_overdue AND role IN ('admin', 'manager')`, [], db);
  if (marked.length) return marked.map((u) => u.id);
  return (await many<{ id: number }>(`SELECT id FROM users WHERE is_active AND role IN ('admin', 'manager')`, [], db)).map((u) => u.id);
}

const link = (id: number) => `/purchases?open=${id}`;

/** Поиск клиента для поля «Для кого»: открыт всем сотрудникам, в том числе тем, у кого нет раздела «Клиенты». */
purchasesRouter.get(
  '/purchases/clients',
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${likeEscape(q)}%`;
    res.json(
      await many<PurchaseClientHit>(
        `SELECT id, name, kind FROM clients WHERE name ILIKE $1 OR inn LIKE $1 ORDER BY (lower(name) LIKE lower($2)) DESC, name LIMIT 8`,
        [like, `${likeEscape(q)}%`],
      ),
    );
  }),
);

/** scope=mine — где я создатель или покупатель; all — все (только тем, кто согласует). Закрытые в конце. */
purchasesRouter.get(
  '/purchases',
  h(async (req, res) => {
    const user = req.user!;
    const where: string[] = [];
    const params: unknown[] = [];
    if (!approves(user.role) || req.query.scope === 'mine') {
      params.push(user.id);
      where.push(`(p.creator_id = $1 OR p.buyer_id = $1)`);
    }
    const rows = await many<Omit<PurchaseItem, 'waitingForMe'> & { buyerId: number }>(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY (p.status IN ('approval', 'buying', 'delivery')) DESC, p.updated_at DESC LIMIT 300`,
      params,
    );
    res.json(rows.map((r) => ({ ...r, waitingForMe: waitingFor({ status: r.status, buyer_id: r.buyerId }, user) })));
  }),
);

async function loadDetail(db: Db, id: number, user: Actor): Promise<PurchaseDetail> {
  const row = await one<Omit<PurchaseItem, 'waitingForMe'>>(`${SELECT} WHERE p.id = $1`, [id], db);
  if (!row) throw new HttpError(404, 'Закупка не найдена');
  const base = { creator_id: row.creatorId, buyer_id: row.buyerId, status: row.status };
  if (!visibleTo(base, user)) throw forbidden();
  const events = await many<PurchaseEvent>(
    `SELECT e.id, e.action, u.full_name AS "actorName", e.comment, e.created_at AS "createdAt"
       FROM purchase_events e JOIN users u ON u.id = e.actor_id WHERE e.purchase_id = $1 ORDER BY e.id`,
    [id],
    db,
  );
  const open = row.status === 'approval' || row.status === 'buying' || row.status === 'delivery';
  return {
    ...row,
    events,
    waitingForMe: waitingFor(base, user),
    canApprove: row.status === 'approval' && approves(user.role),
    canAdvance: (row.status === 'buying' || row.status === 'delivery') && (row.buyerId === user.id || approves(user.role)),
    canCancel: open && (row.creatorId === user.id || approves(user.role)),
  };
}

purchasesRouter.get(
  '/purchases/:id',
  h(async (req, res) => {
    res.json(await loadDetail(pool, intParam(req.params.id), req.user!));
  }),
);

purchasesRouter.post(
  '/purchases',
  h(async (req, res) => {
    const user = req.user!;
    const input = parse(purchaseSchema, req.body);
    const outbox = new Outbox();
    const id = await tx(async (db) => {
      if (input.clientId) {
        const c = await one('SELECT 1 FROM clients WHERE id = $1', [input.clientId], db);
        if (!c) throw new HttpError(400, 'Выберите клиента из списка');
      }
      // Покупает тот, кто завёл заявку, если не назначили другого: как в примере «завожу, согласовываю, закупаю и отвожу»
      const buyerId = input.buyerId ? await activeUser(db, input.buyerId) : user.id;
      const row = await one<{ id: number }>(
        `INSERT INTO purchases (title, client_id, comment, creator_id, buyer_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.title, input.clientId ?? null, input.comment, user.id, buyerId],
        db,
      );
      await db.query(`INSERT INTO purchase_events (purchase_id, actor_id, action) VALUES ($1, $2, 'created')`, [row!.id, user.id]);
      const client = input.clientId ? await one<{ name: string }>('SELECT name FROM clients WHERE id = $1', [input.clientId], db) : null;
      for (const uid of (await approverIds(db)).filter((x) => x !== user.id)) {
        outbox.add({
          userId: uid,
          type: 'purchase_approval',
          title: `Согласуйте закупку: ${input.title}`,
          body: [`От: ${user.fullName}.`, client && `Для: ${client.name}.`, input.comment && `Комментарий: ${input.comment}`].filter(Boolean).join('\n'),
          link: link(row!.id),
        });
      }
      outbox.touch('purchases');
      return row!.id;
    });
    await outbox.flush();
    res.status(201).json({ id });
  }),
);

/**
 * Один шаг закупки. Согласование и отказ — тем, кто согласует; «Куплено» и «Отвёз» — покупателю или тому, кто согласует;
 * отмена — создателю или тому, кто согласует.
 */
function stepRoute(action: 'approve' | 'reject' | 'bought' | 'delivered' | 'cancel') {
  return h(async (req, res) => {
    const user = req.user!;
    const id = intParam(req.params.id);
    const input = parse(purchaseStepSchema, req.body ?? {});
    const outbox = new Outbox();
    await tx(async (db) => {
      const p = await one<PurchaseRow>(`SELECT id, status, title, creator_id, buyer_id FROM purchases WHERE id = $1 FOR UPDATE`, [id], db);
      if (!p) throw new HttpError(404, 'Закупка не найдена');
      if (!visibleTo(p, user)) throw forbidden();
      const need = { approve: 'approval', reject: 'approval', bought: 'buying', delivered: 'delivery' } as const;
      if (action !== 'cancel' && p.status !== need[action]) {
        throw new HttpError(409, 'Этот шаг уже сделан: обновите страницу');
      }
      if (action === 'cancel' && !(p.status === 'approval' || p.status === 'buying' || p.status === 'delivery')) {
        throw new HttpError(409, 'Закупка уже закрыта');
      }
      if ((action === 'approve' || action === 'reject') && !approves(user.role)) throw forbidden('Согласует директор');
      if ((action === 'bought' || action === 'delivered') && !(p.buyer_id === user.id || approves(user.role))) {
        throw forbidden('Отмечает тот, кто покупает, или директор');
      }
      if (action === 'cancel' && !(p.creator_id === user.id || approves(user.role))) throw forbidden('Отменяет тот, кто завёл заявку, или директор');

      let status: PurchaseItem['status'];
      let buyerId = p.buyer_id;
      if (action === 'approve') {
        status = NEXT_STATUS.approval;
        if (input.buyerId) buyerId = await activeUser(db, input.buyerId);
      } else if (action === 'reject') status = 'rejected';
      else if (action === 'cancel') status = 'cancelled';
      else status = NEXT_STATUS[p.status as 'buying' | 'delivery'];
      const event = { approve: 'approved', reject: 'rejected', bought: 'bought', delivered: 'delivered', cancel: 'cancelled' }[action];

      await db.query(`UPDATE purchases SET status = $2, buyer_id = $3, updated_at = now() WHERE id = $1`, [id, status, buyerId]);
      await db.query(`INSERT INTO purchase_events (purchase_id, actor_id, action, comment) VALUES ($1, $2, $3, $4)`, [id, user.id, event, input.comment]);

      const told = new Set<number>([user.id]);
      const note = (userId: number, title: string) => {
        if (told.has(userId)) return;
        told.add(userId);
        outbox.add({ userId, type: 'purchase', title, body: [`${user.fullName}.`, input.comment && `Комментарий: ${input.comment}`].filter(Boolean).join('\n'), link: link(id) });
      };
      if (action === 'approve') {
        note(p.creator_id, `Закупка согласована: ${p.title}`);
        if (buyerId !== p.creator_id) note(buyerId, `Нужно купить: ${p.title}`);
      } else if (action === 'reject') note(p.creator_id, `Закупка отклонена: ${p.title}`);
      else if (action === 'bought') note(p.creator_id, `Куплено: ${p.title}`);
      else if (action === 'delivered') note(p.creator_id, `Отвезено: ${p.title}`);
      else {
        // Отмену создателем видит тот, кто согласует или покупает; отмену директором — создатель
        if (user.id === p.creator_id) for (const uid of await approverIds(db)) note(uid, `Закупка отменена: ${p.title}`);
        else note(p.creator_id, `Закупка отменена: ${p.title}`);
        if (p.buyer_id !== p.creator_id) note(p.buyer_id, `Закупка отменена: ${p.title}`);
      }
      outbox.touch('purchases');
    });
    await outbox.flush();
    res.json({ ok: true });
  });
}

purchasesRouter.post('/purchases/:id/approve', stepRoute('approve'));
purchasesRouter.post('/purchases/:id/reject', stepRoute('reject'));
purchasesRouter.post('/purchases/:id/bought', stepRoute('bought'));
purchasesRouter.post('/purchases/:id/delivered', stepRoute('delivered'));
purchasesRouter.post('/purchases/:id/cancel', stepRoute('cancel'));
