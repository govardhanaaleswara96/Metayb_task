import { OrderStatus, PrismaClient, User } from '@prisma/client';
import { ApiError } from '../middleware/errors';
import { orderScope } from './orders';
import { refreshLoyalty } from './loyalty';
import { recordOrderEvent } from '../integrations/orderEvents';

const transitions = {
  approve: { from: ['PendingApproval'], to: 'Confirmed' },
  reject: { from: ['PendingApproval'], to: 'Rejected' },
  cancel: { from: ['Placed', 'PendingApproval', 'Confirmed'], to: 'Cancelled' },
  dispatch: { from: ['Confirmed'], to: 'Dispatched' },
  deliver: { from: ['Dispatched'], to: 'Delivered' },
} satisfies Record<string, { from: OrderStatus[]; to: OrderStatus }>;
export type OrderAction = keyof typeof transitions;

export async function transitionOrder(db: PrismaClient, actor: User, orderId: string, action: OrderAction) {
  return db.$transaction(async tx => {
    if (action === 'cancel' ? actor.role !== 'DISTRIBUTOR' : actor.role !== 'SALES_MANAGER') {
      throw new ApiError(403, 'FORBIDDEN', action === 'cancel'
        ? 'Only distributors may cancel their own orders' : 'Only sales managers may perform this action');
    }
    // Obtain SQLite's write lock before reading the lifecycle state. A concurrent
    // transition must observe the previous committed transition before proceeding.
    const locked = await tx.order.updateMany({
      where: { id: orderId, ...orderScope(actor) }, data: { totalMinor: { increment: 0 } },
    });
    if (locked.count !== 1) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const transition: { from: readonly OrderStatus[]; to: OrderStatus } = transitions[action];
    if (!transition.from.includes(order.status)) {
      throw new ApiError(409, 'INVALID_TRANSITION', `Cannot ${action} an order in ${order.status}`, { status: order.status });
    }
    const changed = await tx.order.updateMany({
      where: { id: order.id, status: order.status }, data: { status: transition.to },
    });
    if (changed.count !== 1) throw new ApiError(409, 'INVALID_TRANSITION', 'Order status changed; reload the order');
    const now = new Date();
    if (action === 'reject' || action === 'cancel' || action === 'dispatch') {
      for (const item of order.items) {
        const released = await tx.product.updateMany({
          where: { id: item.productId, reservedQuantity: { gte: item.quantity },
            ...(action === 'dispatch' ? { stockQuantity: { gte: item.quantity } } : {}) },
          data: { reservedQuantity: { decrement: item.quantity },
            ...(action === 'dispatch' ? { stockQuantity: { decrement: item.quantity } } : {}) },
        });
        if (released.count !== 1) throw new ApiError(409, 'INVENTORY_INCONSISTENT', 'Order reservation is inconsistent', { productId: item.productId });
      }
    }
    if (action === 'approve') {
      await tx.pointsEntry.create({ data: {
        distributorId: order.distributorId, orderId: order.id, kind: 'AWARD',
        pointsDelta: Math.floor(order.totalMinor / 10000), createdAt: now,
      } });
    }
    if (action === 'cancel' && order.status === 'Confirmed') {
      const award = await tx.pointsEntry.findUnique({ where: { orderId_kind: { orderId: order.id, kind: 'AWARD' } } });
      if (!award) throw new ApiError(409, 'POINTS_INCONSISTENT', 'Confirmed order has no points award');
      await tx.pointsEntry.create({ data: {
        distributorId: order.distributorId, orderId: order.id, kind: 'REVERSAL',
        pointsDelta: -award.pointsDelta, reversesEntryId: award.id, createdAt: now,
      } });
    }
    const loyalty = await refreshLoyalty(tx, order.distributorId, now);
    await recordOrderEvent(tx, {
      distributorId: order.distributorId, orderId: order.id, fromStatus: order.status, toStatus: transition.to,
      actorType: 'USER', actorUserId: actor.id, createdAt: now,
    });
    const updated = await tx.order.findUniqueOrThrow({
      where: { id: order.id }, include: { items: true, events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    return { ...updated, loyalty };
  }, { timeout: 10000 });
}
