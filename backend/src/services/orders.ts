import { Prisma, PrismaClient, User } from '@prisma/client';
import { ApiError } from '../middleware/errors';
import { refreshLoyalty } from './loyalty';
import { recordOrderEvent } from '../integrations/orderEvents';
const maxInt = 2147483647;
interface Line { productId: string; quantity: number }
function parseLines(body: unknown): Line[] {
  if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items) || !body.items.length) {
    throw new ApiError(400, 'INVALID_ORDER', 'Provide one or more items');
  }
  const seen = new Set<string>();
  return body.items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('productId' in item) || typeof item.productId !== 'string' || !item.productId.trim() ||
      !('quantity' in item) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > maxInt) {
      throw new ApiError(400, 'INVALID_ITEM', 'Each item requires a productId and positive integer quantity');
    }
    if (seen.has(item.productId)) throw new ApiError(400, 'DUPLICATE_PRODUCT', 'Duplicate product lines are not allowed', { productId: item.productId });
    seen.add(item.productId);
    return { productId: item.productId, quantity: item.quantity };
  });
}
function minor(value: bigint): number {
  if (value < 0n || value > BigInt(maxInt)) throw new ApiError(400, 'AMOUNT_TOO_LARGE', 'Order amount exceeds supported range');
  return Number(value);
}
export async function availableCredit(tx: Prisma.TransactionClient, distributorId: string, creditLimitMinor: number) {
  const outstanding = await tx.order.aggregate({
    where: { distributorId, status: { notIn: ['Delivered', 'Cancelled', 'Rejected'] } }, _sum: { totalMinor: true },
  });
  return creditLimitMinor - (outstanding._sum.totalMinor ?? 0);
}
export async function resolveActor(db: PrismaClient, userId: string | undefined): Promise<User> {
  if (!userId) throw new ApiError(400, 'ACTOR_REQUIRED', 'Provide the seeded actor ID in x-user-id');
  const actor = await db.user.findUnique({ where: { id: userId } });
  if (!actor) throw new ApiError(400, 'INVALID_ACTOR', 'Unknown actor');
  return actor;
}
export async function placeOrder(db: PrismaClient, actor: User, body: unknown, idempotencyKey?: string) {
  if (actor.role !== 'DISTRIBUTOR') throw new ApiError(403, 'FORBIDDEN', 'Only distributors may place orders');
  if (idempotencyKey !== undefined && !idempotencyKey.trim()) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must not be blank');
  return db.$transaction(async tx => {
    // Acquire SQLite's write lock before balance/stock reads. Concurrent writers
    // cannot both price/check credit against the same pre-placement database state.
    const locked = await tx.distributor.updateMany({ where: { userId: actor.id }, data: { creditLimitMinor: { increment: 0 } } });
    if (locked.count !== 1) throw new ApiError(400, 'INVALID_DISTRIBUTOR', 'Actor has no distributor profile');
    const distributor = await tx.distributor.findUniqueOrThrow({ where: { userId: actor.id } });
    const now = new Date();
    if (idempotencyKey !== undefined) {
      // Lookup under the same SQLite write lock used by placement. A concurrent
      // duplicate waits for the first commit and returns it without any new effects.
      const existing = await tx.order.findUnique({
        where: { distributorId_idempotencyKey: { distributorId: distributor.id, idempotencyKey } },
        include: { items: true, events: true },
      });
      if (existing) return { ...existing, loyalty: await refreshLoyalty(tx, distributor.id, now) };
    }
    const lines = parseLines(body);
    const loyalty = await refreshLoyalty(tx, distributor.id, now);
    const discountPercent = { BRONZE: 0, SILVER: 3, GOLD: 6 }[loyalty.tier];
    const products = await tx.product.findMany({ where: { id: { in: lines.map(line => line.productId) } } });
    const items = lines.map(line => {
      const product = products.find(product => product.id === line.productId);
      if (!product) throw new ApiError(400, 'INVALID_PRODUCT', 'Unknown product', { productId: line.productId });
      const availableQuantity = product.stockQuantity - product.reservedQuantity;
      if (line.quantity > availableQuantity) throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Insufficient available stock', { sku: product.sku, availableQuantity });
      return { ...line, unitPriceMinor: product.unitPriceMinor, lineSubtotalMinor: minor(BigInt(product.unitPriceMinor) * BigInt(line.quantity)) };
    });
    const subtotalMinor = minor(items.reduce((sum, item) => sum + BigInt(item.lineSubtotalMinor), 0n));
    const discountMinor = minor((BigInt(subtotalMinor) * BigInt(discountPercent) + 50n) / 100n);
    const totalMinor = subtotalMinor - discountMinor;
    const credit = await availableCredit(tx, distributor.id, distributor.creditLimitMinor);
    const status = totalMinor > credit ? 'PendingApproval' : 'Confirmed';
    for (const item of items) {
      const changed = await tx.$executeRaw`UPDATE "Product" SET "reservedQuantity" = "reservedQuantity" + ${item.quantity}
        WHERE "id" = ${item.productId} AND "stockQuantity" - "reservedQuantity" >= ${item.quantity}`;
      if (changed !== 1) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Insufficient available stock', { sku: product.sku, availableQuantity: product.stockQuantity - product.reservedQuantity });
      }
    }
    const placed = await tx.order.create({ data: {
      distributorId: distributor.id, idempotencyKey, status: 'Placed', subtotalMinor, discountPercent, discountMinor, totalMinor,
      createdAt: now, items: { create: items },
    } });
    await tx.order.update({ where: { id: placed.id }, data: { status } });
    await recordOrderEvent(tx, { orderId: placed.id, distributorId: distributor.id, fromStatus: 'Placed', toStatus: status, actorType: 'SYSTEM', createdAt: now });
    if (status === 'Confirmed') {
      await tx.pointsEntry.create({ data: { distributorId: distributor.id, orderId: placed.id, kind: 'AWARD', pointsDelta: Math.floor(totalMinor / 10000), createdAt: now } });
    }
    const currentLoyalty = await refreshLoyalty(tx, distributor.id, now);
    const order = await tx.order.findUniqueOrThrow({ where: { id: placed.id }, include: { items: true, events: true } });
    return { ...order, loyalty: currentLoyalty };
  }, { timeout: 10000 });
}
export function orderScope(actor: User): Prisma.OrderWhereInput {
  return actor.role === 'SALES_MANAGER' ? {} : { distributor: { userId: actor.id } };
}
