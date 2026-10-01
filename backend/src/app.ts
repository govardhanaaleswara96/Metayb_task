import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { prisma } from './db';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from './middleware/errors';
import { availableCredit, orderScope, placeOrder, resolveActor } from './services/orders';
import { refreshLoyalty } from './services/loyalty';
import { OrderAction, transitionOrder } from './services/lifecycle';
export function createApp(db: PrismaClient = prisma) {
  const app = express();
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json());
  app.get('/api/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });
  app.get('/api/users', async (_req, res) => {
    res.json(await db.user.findMany({ include: { distributor: true }, orderBy: { id: 'asc' } }));
  });
  app.get('/api/products', async (_req, res) => {
    const products = await db.product.findMany({ orderBy: { sku: 'asc' } });
    res.json(products.map(product => ({ ...product, availableStock: product.stockQuantity - product.reservedQuantity })));
  });
  app.post('/api/orders', async (req, res) => {
    const actor = await resolveActor(db, req.get('x-user-id'));
    res.status(201).json(await placeOrder(db, actor, req.body, req.get('Idempotency-Key')));
  });
  const lifecycleActions: OrderAction[] = ['approve', 'reject', 'cancel', 'dispatch', 'deliver'];
  for (const action of lifecycleActions) {
    app.post(`/api/orders/:id/${action}`, async (req, res) => {
      const actor = await resolveActor(db, req.get('x-user-id'));
      res.json(await transitionOrder(db, actor, String(req.params.id), action));
    });
  }
  app.get('/api/orders', async (req, res) => {
    const actor = await resolveActor(db, req.get('x-user-id'));
    res.json(await db.order.findMany({
      where: orderScope(actor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { items: { include: { product: { select: { sku: true, name: true } } } } },
    }));
  });
  app.get('/api/orders/:id', async (req, res) => {
    const actor = await resolveActor(db, req.get('x-user-id'));
    const order = await db.order.findFirst({
      where: { ...orderScope(actor), id: String(req.params.id) },
      include: { items: { include: { product: { select: { sku: true, name: true } } } }, events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    res.json(order);
  });
  app.get('/api/distributors/me', async (req, res) => {
    const actor = await resolveActor(db, req.get('x-user-id'));
    if (actor.role !== 'DISTRIBUTOR') throw new ApiError(403, 'FORBIDDEN', 'Only distributors have a loyalty profile');
    const summary = await db.$transaction(async tx => {
      const locked = await tx.distributor.updateMany({ where: { userId: actor.id }, data: { creditLimitMinor: { increment: 0 } } });
      if (locked.count !== 1) throw new ApiError(400, 'INVALID_DISTRIBUTOR', 'Actor has no distributor profile');
      const distributor = await tx.distributor.findUniqueOrThrow({ where: { userId: actor.id } });
      return { ...distributor, ...await refreshLoyalty(tx, distributor.id, new Date()),
        availableCreditMinor: await availableCredit(tx, distributor.id, distributor.creditLimitMinor) };
    });
    res.json(summary);
  });
  app.use((_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }); });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const invalidJson = error instanceof SyntaxError && 'status' in error && error.status === 400;
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, ...error.details } });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P1008', 'P2034'].includes(error.code)) {
      res.status(409).json({ error: { code: 'DATABASE_BUSY', message: 'Database is busy; please try again' } });
      return;
    }
    if (!invalidJson) console.error(error);
    res.status(invalidJson ? 400 : 500).json({ error: { code: invalidJson ? 'INVALID_JSON' : 'INTERNAL_ERROR', message: invalidJson ? 'Invalid JSON body' : 'An unexpected error occurred' } });
  };
  app.use(errorHandler);


  return app;

}
export const app = createApp();
