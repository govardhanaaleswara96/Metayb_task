import { PrismaClient, OrderStatus } from '@prisma/client';
const prisma = new PrismaClient();
const products = [
  ['SKU-001', 'Rice Bag', 125000, 100],
  ['SKU-002', 'Cooking Oil', 25000, 80],
  ['SKU-003', 'Wheat Flour', 45000, 60],
  ['SKU-004', 'Sugar Pack', 15000, 120],
  ['SKU-005', 'Tea Box', 30000, 40],
  ['SKU-006', 'Soap Carton', 60000, 30],
  ['SKU-007', 'Coffee Pack', 50000, 0],
  ['SKU-008', 'Premium Spice Box', 75000, 1],
] as const;
async function main() {
  await prisma.$transaction(async tx => {
    // Stable IDs and create-only upserts preserve existing data on repeat runs.
    for (const [sku, name, unitPriceMinor, stockQuantity] of products) {
      await tx.product.upsert({ where: { sku }, update: {}, create: { id: sku, sku, name, unitPriceMinor, stockQuantity } });
    }
    await tx.user.upsert({ where: { id: 'manager' }, update: {}, create: { id: 'manager', name: 'Sales Manager', role: 'SALES_MANAGER' } });
    for (const [id, name, creditLimitMinor, historicalQuantity] of [
      ['bronze', 'Bronze Distributor', 500000, 0],
      ['silver', 'Silver Distributor', 2000000, 392],
      ['gold', 'Gold Distributor', 10000000, 400],
    ] as const) {
      await tx.user.upsert({ where: { id }, update: {}, create: { id, name, role: 'DISTRIBUTOR' } });
      await tx.distributor.upsert({ where: { id }, update: {}, create: { id, userId: id, creditLimitMinor, tier: 'BRONZE' } });
      const orderId = `history-${id}`;
      if (historicalQuantity && !await tx.order.findUnique({ where: { id: orderId } })) {
        const placedAt = new Date(Date.now() - 30 * 86400000);
        const confirmedAt = new Date(placedAt.getTime() + 60000);
        const dispatchedAt = new Date(placedAt.getTime() + 86400000);
        const deliveredAt = new Date(placedAt.getTime() + 2 * 86400000);
        const totalMinor = historicalQuantity * 125000;
        // Each distributor was Bronze at this historical placement: discount 0%.
        // Seed current stock represents inventory AFTER these historical dispatches.
        await tx.order.create({ data: {
          id: orderId, distributorId: id, status: 'Delivered', subtotalMinor: totalMinor,
          discountPercent: 0, discountMinor: 0, totalMinor, createdAt: placedAt,
          items: { create: { id: `${orderId}-item`, productId: 'SKU-001', quantity: historicalQuantity, unitPriceMinor: 125000, lineSubtotalMinor: totalMinor } },
          pointsEntries: { create: { id: `${orderId}-award`, distributorId: id, kind: 'AWARD', pointsDelta: Math.floor(totalMinor / 10000), createdAt: confirmedAt } },
          events: { create: [
            { id: `${orderId}-pending`, fromStatus: 'Placed', toStatus: 'PendingApproval', actorType: 'SYSTEM', createdAt: placedAt },
            { id: `${orderId}-confirmed`, fromStatus: 'PendingApproval', toStatus: 'Confirmed', actorType: 'USER', actorUserId: 'manager', createdAt: confirmedAt },
            { id: `${orderId}-dispatched`, fromStatus: 'Confirmed', toStatus: 'Dispatched', actorType: 'USER', actorUserId: 'manager', createdAt: dispatchedAt },
            { id: `${orderId}-delivered`, fromStatus: 'Dispatched', toStatus: 'Delivered', actorType: 'USER', actorUserId: 'manager', createdAt: deliveredAt },
          ] },
        } });

      }
      const entries = await tx.pointsEntry.findMany({ where: { distributorId: id, kind: 'AWARD', createdAt: { gte: new Date(Date.now() - 90 * 86400000) } }, include: { reversal: true } });
      const balance = entries.reduce((sum, entry) => sum + entry.pointsDelta + (entry.reversal?.pointsDelta ?? 0), 0);
      await tx.distributor.update({ where: { id }, data: { tier: balance >= 5000 ? 'GOLD' : balance >= 1000 ? 'SILVER' : 'BRONZE' } });
    }
  });
  const history = await prisma.order.count({ where: { status: OrderStatus.Delivered } });
  console.log(`Seed complete: 8 products, 3 distributors, 1 manager; ${history} delivered historical orders.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
