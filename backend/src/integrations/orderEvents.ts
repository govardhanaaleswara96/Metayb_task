import { ActorType, OrderStatus, Prisma } from '@prisma/client';
export async function recordOrderEvent(tx: Prisma.TransactionClient, data: {
  orderId: string; distributorId: string; fromStatus: OrderStatus; toStatus: OrderStatus;
  actorType: ActorType; actorUserId?: string; createdAt: Date;
}) {
  const { distributorId, ...eventData } = data;
  const event = await tx.orderEvent.create({ data: eventData });
  await tx.erpOutbox.create({ data: {
    orderEventId: event.id, nextAttemptAt: event.createdAt,
    payloadJson: JSON.stringify({ eventId: event.id, orderId: event.orderId, distributorId,
      previousStatus: event.fromStatus, newStatus: event.toStatus,
      actor: { type: event.actorType, userId: event.actorUserId }, timestamp: event.createdAt.toISOString() }),
  } });
  return event;
}
