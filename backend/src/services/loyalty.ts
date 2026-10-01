import { Prisma, Tier } from '@prisma/client';
export async function refreshLoyalty(tx: Prisma.TransactionClient, distributorId: string, now: Date) {
  const awards = await tx.pointsEntry.findMany({
    where: { distributorId, kind: 'AWARD', createdAt: { gte: new Date(now.getTime() - 90 * 86400000), lte: now } },
    include: { reversal: true },
  });
  const points = awards.reduce((sum, award) => sum + award.pointsDelta +
    (award.reversal && award.reversal.createdAt <= now ? award.reversal.pointsDelta : 0), 0);
  const tier: Tier = points >= 5000 ? 'GOLD' : points >= 1000 ? 'SILVER' : 'BRONZE';
  await tx.distributor.update({ where: { id: distributorId }, data: { tier } });
  return { points, tier };
}
