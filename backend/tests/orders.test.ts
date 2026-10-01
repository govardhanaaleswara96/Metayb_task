import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { refreshLoyalty } from '../src/services/loyalty';
let db: PrismaClient;
let server: Server;
let base: string;
let directory: string;
let sequence = 0;
let actor: string;
let other: string;
let product: string;
let last: string;
let zero: string;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'metayb-orders-'));
  const path = join(directory, 'test.db');
  writeFileSync(path, '');
  const url = `file:${path}`;
  execFileSync(process.execPath, [resolve('../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  await db.user.create({ data: { id: 'test-manager', name: 'Manager', role: 'SALES_MANAGER' } });
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (db) await db.$disconnect();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  sequence++;
  actor = `d-${sequence}`; other = `other-${sequence}`;
  product = `p-${sequence}`; last = `last-${sequence}`; zero = `zero-${sequence}`;
  for (const id of [actor, other]) await db.user.create({ data: {
    id, name: id, role: 'DISTRIBUTOR', distributor: { create: { id, creditLimitMinor: 500000 } },
  } });
  await db.product.createMany({ data: [
    { id: product, sku: product, name: 'Rice', unitPriceMinor: 125000, stockQuantity: 100 },
    { id: last, sku: last, name: 'Last unit', unitPriceMinor: 10000, stockQuantity: 1 },
    { id: zero, sku: zero, name: 'Unavailable', unitPriceMinor: 10000, stockQuantity: 0 },
  ] });
});
async function request(path: string, user = actor, body?: unknown) {
  return fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-user-id': user, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const orderBody = (quantity = 1) => ({ items: [{ productId: product, quantity }] });
async function historicalAward(points: number, ageDays = 30) {
  const timestamp = new Date(Date.now() - ageDays * 86400000);
  const totalMinor = points * 10000;
  await db.order.create({ data: {
    distributorId: actor, status: 'Delivered', subtotalMinor: totalMinor, discountPercent: 0, discountMinor: 0, totalMinor, createdAt: timestamp,
    items: { create: { productId: product, quantity: 1, unitPriceMinor: totalMinor, lineSubtotalMinor: totalMinor } },
    pointsEntries: { create: { distributorId: actor, kind: 'AWARD', pointsDelta: points, createdAt: timestamp } },
  } });
}
test('successful multi-line reservation changes reserved stock only', async () => {
  const response = await request('/orders', actor, { items: [{ productId: product, quantity: 2 }, { productId: last, quantity: 1 }] });
  assert.equal(response.status, 201);
  const placed = await response.json();
  assert.equal(placed.items.length, 2);
  const rice = await db.product.findUniqueOrThrow({ where: { id: product } });
  const final = await db.product.findUniqueOrThrow({ where: { id: last } });
  assert.equal(rice.stockQuantity, 100); assert.equal(rice.reservedQuantity, 2);
  assert.equal(final.stockQuantity, 1); assert.equal(final.reservedQuantity, 1);
});
test('insufficient second line rejects the whole order and reserves nothing', async () => {
  const response = await request('/orders', actor, { items: [{ productId: product, quantity: 2 }, { productId: last, quantity: 2 }] });
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).error, { code: 'INSUFFICIENT_STOCK', message: 'Insufficient available stock', sku: last, availableQuantity: 1 });
  assert.equal(await db.order.count({ where: { distributorId: actor } }), 0);
  assert.equal(await db.pointsEntry.count({ where: { distributorId: actor } }), 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: last } })).reservedQuantity, 0);
});
test('zero physical stock and fully reserved stock are unavailable', async () => {
  for (const id of [zero, last]) {
    if (id === last) await db.product.update({ where: { id }, data: { reservedQuantity: 1 } });
    const response = await request('/orders', actor, { items: [{ productId: id, quantity: 1 }] });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.availableQuantity, 0);
  }
  assert.equal(await db.order.count({ where: { distributorId: actor } }), 0);
});
test('within-credit confirms and awards points exactly once with one transition', async () => {
  const response = await request('/orders', actor, orderBody(2));
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(order.status, 'Confirmed'); assert.equal(order.totalMinor, 250000);
  assert.deepEqual(order.loyalty, { points: 25, tier: 'BRONZE' });
  assert.equal(await db.pointsEntry.count({ where: { orderId: order.id } }), 1);
  assert.equal(order.events.length, 1);
  assert.equal(order.events[0].fromStatus, 'Placed'); assert.equal(order.events[0].toStatus, 'Confirmed');
  assert.equal(order.events[0].actorType, 'SYSTEM'); assert.ok(order.events[0].createdAt);
  const summary = await (await request('/distributors/me')).json();
  assert.equal(summary.points, 25); assert.equal(summary.availableCreditMinor, 250000);
  await assert.rejects(db.pointsEntry.create({ data: { orderId: order.id, distributorId: actor, kind: 'AWARD', pointsDelta: 25 } }));
});
test('over-credit stays pending without points; existing pending orders consume credit', async () => {
  let response = await request('/orders', actor, orderBody(5));
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.status, 'PendingApproval'); assert.equal(first.events[0].toStatus, 'PendingApproval');
  response = await request('/orders', actor, orderBody());
  assert.equal((await response.json()).status, 'PendingApproval');
  assert.equal(await db.pointsEntry.count({ where: { distributorId: actor } }), 0);
});
test('confirmed outstanding orders consume credit and exact credit is sufficient', async () => {
  const first = await request('/orders', actor, orderBody(4));
  assert.equal((await first.json()).status, 'Confirmed');
  const next = await request('/orders', actor, orderBody());
  assert.equal((await next.json()).status, 'PendingApproval');
});
test('Silver to Gold example uses current points; existing price/discount snapshots stay fixed', async () => {
  await historicalAward(4900);
  await db.distributor.update({ where: { id: actor }, data: { creditLimitMinor: 2000000, tier: 'BRONZE' } });
  const response = await request('/orders', actor, { ...orderBody(10), totalMinor: 1, discountPercent: 100, tier: 'GOLD' });
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.subtotalMinor, 1250000); assert.equal(first.discountPercent, 3);
  assert.equal(first.discountMinor, 37500); assert.equal(first.totalMinor, 1212500);
  assert.deepEqual(first.loyalty, { points: 5021, tier: 'GOLD' });
  await db.product.update({ where: { id: product }, data: { unitPriceMinor: 150000 } });
  const next = await (await request('/orders', actor, orderBody())).json();
  assert.equal(next.discountPercent, 6); assert.equal(next.items[0].unitPriceMinor, 150000);
  const original = await (await request(`/orders/${first.id}`)).json();
  assert.equal(original.discountPercent, 3); assert.equal(original.totalMinor, 1212500);
  assert.equal(original.items[0].unitPriceMinor, 125000);
});
test('expired awards do not determine current placement tier', async () => {
  await historicalAward(5000, 91);
  await db.distributor.update({ where: { id: actor }, data: { tier: 'GOLD' } });
  const order = await (await request('/orders', actor, orderBody())).json();
  assert.equal(order.discountPercent, 0); assert.equal(order.loyalty.points, 12);
});
test('duplicate products and invalid quantities are rejected without mutation', async () => {
  const bodies: unknown[] = [{ items: [] }, { items: [{ productId: product, quantity: 1 }, { productId: product, quantity: 1 }] },
    ...[0, -1, 1.5, '1', null].map(quantity => ({ items: [{ productId: product, quantity }] }))];
  for (const body of bodies) assert.equal((await request('/orders', actor, body)).status, 400);
  assert.equal(await db.order.count({ where: { distributorId: actor } }), 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
});
test('unknown products and invalid/non-distributor actors are rejected', async () => {
  assert.equal((await request('/orders', actor, { items: [{ productId: 'missing', quantity: 1 }] })).status, 400);
  assert.equal((await request('/orders', 'missing', orderBody())).status, 400);
  assert.equal((await request('/orders', '', orderBody())).status, 400);
  assert.equal((await request('/orders', 'test-manager', orderBody())).status, 403);
});
test('distributors see only their own orders while manager sees all', async () => {
  const order = await (await request('/orders', actor, orderBody())).json();
  const mine = await (await request('/orders')).json();
  assert.equal(mine.length, 1); assert.equal(mine[0].id, order.id);
  assert.deepEqual(await (await request('/orders', other)).json(), []);
  assert.equal((await request(`/orders/${order.id}`, other)).status, 404);
  assert.equal((await request(`/orders/${order.id}`, 'test-manager')).status, 200);
  const all = await (await request('/orders', 'test-manager')).json();
  assert.ok(all.some((entry: { id: string }) => entry.id === order.id));
  assert.equal((await fetch(`${base}/orders/${order.id}`, { method: 'PATCH', headers: { 'x-user-id': actor } })).status, 404);
});
test('discount rounds to nearest minor unit and points floor the discounted total', async () => {
  await historicalAward(1000);
  await db.product.update({ where: { id: product }, data: { unitPriceMinor: 10050 } });
  const order = await (await request('/orders', actor, orderBody())).json();
  assert.equal(order.discountMinor, 302); assert.equal(order.totalMinor, 9748);
  const award = await db.pointsEntry.findFirstOrThrow({ where: { orderId: order.id } });
  assert.equal(award.pointsDelta, 0);
});
test('failure after reservation rolls back orders, points, events, tier and inventory', async () => {
  await historicalAward(1000);
  const ordersBefore = await db.order.count({ where: { distributorId: actor } });
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_order_insert BEFORE INSERT ON "Order" BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try {
    assert.equal((await request('/orders', actor, orderBody())).status, 500);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER fail_order_insert'); }
  assert.equal(await db.order.count({ where: { distributorId: actor } }), ordersBefore);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
  assert.equal((await db.distributor.findUniqueOrThrow({ where: { id: actor } })).tier, 'BRONZE');
  assert.equal(await db.pointsEntry.count({ where: { distributorId: actor } }), 1);
  assert.equal(await db.orderEvent.count({ where: { order: { distributorId: actor } } }), 0);
});

async function place(quantity = 1) {
  const response = await request('/orders', actor, orderBody(quantity));
  assert.equal(response.status, 201);
  return response.json();
}
async function act(orderId: string, action: string, user = 'test-manager') {
  return request(`/orders/${orderId}/${action}`, user, {});
}
async function storedState(orderId: string) {
  return {
    order: await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, events: { include: { outbox: true } }, pointsEntries: true } }),
    products: await db.product.findMany({ where: { id: { in: [product, last] } }, orderBy: { id: 'asc' } }),
    distributor: await db.distributor.findUniqueOrThrow({ where: { id: actor } }),
  };
}
function checkUserEvent(order: { events: { fromStatus: string; toStatus: string; actorType: string; actorUserId: string | null; createdAt: string }[] }, from: string, to: string, user: string) {
  const events = order.events.filter(event => event.fromStatus === from && event.toStatus === to);
  assert.equal(events.length, 1);
  assert.equal(events[0].actorType, 'USER'); assert.equal(events[0].actorUserId, user);
  assert.ok(Number.isFinite(Date.parse(events[0].createdAt)));
}
test('manager approves pending order once, awarding points and recalculating tier', async () => {
  await historicalAward(990);
  await db.distributor.update({ where: { id: actor }, data: { creditLimitMinor: 0 } });
  const pending = await place();
  assert.equal(pending.status, 'PendingApproval');
  const response = await act(pending.id, 'approve');
  assert.equal(response.status, 200);
  const confirmed = await response.json();
  assert.equal(confirmed.status, 'Confirmed');
  assert.deepEqual(confirmed.loyalty, { points: 1002, tier: 'SILVER' });
  assert.equal(confirmed.totalMinor, pending.totalMinor); assert.equal(confirmed.discountPercent, 0);
  assert.equal(await db.pointsEntry.count({ where: { orderId: pending.id, kind: 'AWARD' } }), 1);
  checkUserEvent(confirmed, 'PendingApproval', 'Confirmed', 'test-manager');
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 1);
  const beforeRepeat = await storedState(pending.id);
  assert.equal((await act(pending.id, 'approve')).status, 409);
  assert.deepEqual(await storedState(pending.id), beforeRepeat);
  const next = await place();
  assert.equal(next.discountPercent, 3);
});
test('manager rejects pending order once and releases all reservations without points', async () => {
  const pending = await place(5);
  const response = await act(pending.id, 'reject');
  assert.equal(response.status, 200);
  const rejected = await response.json();
  assert.equal(rejected.status, 'Rejected');
  checkUserEvent(rejected, 'PendingApproval', 'Rejected', 'test-manager');
  const stock = await db.product.findUniqueOrThrow({ where: { id: product } });
  assert.equal(stock.stockQuantity, 100); assert.equal(stock.reservedQuantity, 0);
  assert.equal(await db.pointsEntry.count({ where: { orderId: pending.id } }), 0);
  const summary = await (await request('/distributors/me')).json();
  assert.equal(summary.availableCreditMinor, 500000);
  const beforeRepeat = await storedState(pending.id);
  assert.equal((await act(pending.id, 'reject')).status, 409);
  assert.deepEqual(await storedState(pending.id), beforeRepeat);
});
test('distributor cancellation is restricted to ownership and manager cannot cancel', async () => {
  const order = await place();
  const unchanged = await storedState(order.id);
  assert.equal((await act(order.id, 'cancel', other)).status, 404);
  assert.equal((await act(order.id, 'cancel', 'test-manager')).status, 403);
  assert.deepEqual(await storedState(order.id), unchanged);
  const response = await act(order.id, 'cancel', actor);
  assert.equal(response.status, 200);
  checkUserEvent(await response.json(), 'Confirmed', 'Cancelled', actor);
});
test('PendingApproval cancellation releases stock without awarding or reversing points', async () => {
  const order = await place(5);
  const response = await act(order.id, 'cancel', actor);
  assert.equal(response.status, 200);
  const cancelled = await response.json();
  assert.equal(cancelled.status, 'Cancelled');
  checkUserEvent(cancelled, 'PendingApproval', 'Cancelled', actor);
  const stock = await db.product.findUniqueOrThrow({ where: { id: product } });
  assert.equal(stock.stockQuantity, 100); assert.equal(stock.reservedQuantity, 0);
  assert.equal(await db.pointsEntry.count({ where: { orderId: order.id } }), 0);
  const beforeRepeat = await storedState(order.id);
  assert.equal((await act(order.id, 'cancel', actor)).status, 409);
  assert.deepEqual(await storedState(order.id), beforeRepeat);
});
test('Placed cancellation is permitted and releases its reservation without points', async () => {
  // Placement normally routes immediately; construct its valid intermediate state.
  const placed = await db.order.create({ data: {
    distributorId: actor, status: 'Placed', subtotalMinor: 125000, discountPercent: 0, discountMinor: 0, totalMinor: 125000,
    items: { create: { productId: product, quantity: 1, unitPriceMinor: 125000, lineSubtotalMinor: 125000 } },
  } });
  await db.product.update({ where: { id: product }, data: { reservedQuantity: 1 } });
  const response = await act(placed.id, 'cancel', actor);
  assert.equal(response.status, 200);
  checkUserEvent(await response.json(), 'Placed', 'Cancelled', actor);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
  assert.equal(await db.pointsEntry.count({ where: { orderId: placed.id } }), 0);
});
test('Confirmed cancellation reverses original award once, lowers tier and fixes next discount', async () => {
  await historicalAward(4900);
  await db.distributor.update({ where: { id: actor }, data: { creditLimitMinor: 2000000 } });
  const order = await place(10);
  assert.deepEqual(order.loyalty, { points: 5021, tier: 'GOLD' });
  const original = await db.pointsEntry.findFirstOrThrow({ where: { orderId: order.id, kind: 'AWARD' } });
  const response = await act(order.id, 'cancel', actor);
  assert.equal(response.status, 200);
  const cancelled = await response.json();
  assert.deepEqual(cancelled.loyalty, { points: 4900, tier: 'SILVER' });
  assert.equal(cancelled.totalMinor, order.totalMinor); assert.equal(cancelled.discountPercent, 3);
  const reversal = await db.pointsEntry.findFirstOrThrow({ where: { orderId: order.id, kind: 'REVERSAL' } });
  assert.equal(reversal.pointsDelta, -121); assert.equal(reversal.reversesEntryId, original.id);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).stockQuantity, 100);
  const snapshot = await storedState(order.id);
  assert.equal((await act(order.id, 'cancel', actor)).status, 409);
  assert.deepEqual(await storedState(order.id), snapshot);
  assert.equal((await place()).discountPercent, 3);
});
test('dispatch deducts physical stock and reservation exactly once without altering points', async () => {
  const response = await request('/orders', actor, { items: [{ productId: product, quantity: 2 }, { productId: last, quantity: 1 }] });
  const order = await response.json();
  const dispatched = await act(order.id, 'dispatch');
  assert.equal(dispatched.status, 200);
  const data = await dispatched.json();
  checkUserEvent(data, 'Confirmed', 'Dispatched', 'test-manager');
  const rice = await db.product.findUniqueOrThrow({ where: { id: product } });
  const final = await db.product.findUniqueOrThrow({ where: { id: last } });
  assert.equal(rice.stockQuantity, 98); assert.equal(rice.reservedQuantity, 0);
  assert.equal(final.stockQuantity, 0); assert.equal(final.reservedQuantity, 0);
  assert.equal(await db.pointsEntry.count({ where: { orderId: order.id } }), 1);
  const snapshot = await storedState(order.id);
  assert.equal((await act(order.id, 'dispatch')).status, 409);
  assert.equal((await act(order.id, 'cancel', actor)).status, 409);
  assert.deepEqual(await storedState(order.id), snapshot);
});
test('delivery releases credit exposure and leaves dispatched stock and points unchanged', async () => {
  const order = await place(2);
  assert.equal((await act(order.id, 'dispatch')).status, 200);
  const before = await storedState(order.id);
  assert.equal((await (await request('/distributors/me')).json()).availableCreditMinor, 250000);
  const response = await act(order.id, 'deliver');
  assert.equal(response.status, 200);
  checkUserEvent(await response.json(), 'Dispatched', 'Delivered', 'test-manager');
  const delivered = await storedState(order.id);
  assert.deepEqual(delivered.products, before.products);
  assert.deepEqual(delivered.order.pointsEntries, before.order.pointsEntries);
  assert.equal((await (await request('/distributors/me')).json()).availableCreditMinor, 500000);
  const snapshot = await storedState(order.id);
  assert.equal((await act(order.id, 'deliver')).status, 409);
  assert.equal((await act(order.id, 'cancel', actor)).status, 409);
  assert.deepEqual(await storedState(order.id), snapshot);
});
test('distributors cannot approve, reject, dispatch or deliver', async () => {
  const pending = await place(5);
  const snapshot = await storedState(pending.id);
  for (const action of ['approve', 'reject', 'dispatch', 'deliver']) {
    assert.equal((await act(pending.id, action, actor)).status, 403);
  }
  assert.deepEqual(await storedState(pending.id), snapshot);
});
test('every disallowed action/state pair returns 409 and leaves all data unchanged', async () => {
  const allowed: Record<string, string[]> = {
    approve: ['PendingApproval'], reject: ['PendingApproval'], cancel: ['Placed', 'PendingApproval', 'Confirmed'],
    dispatch: ['Confirmed'], deliver: ['Dispatched'],
  };
  for (const status of ['Placed', 'PendingApproval', 'Confirmed', 'Rejected', 'Dispatched', 'Delivered', 'Cancelled'] as const) {
    const order = await db.order.create({ data: {
      distributorId: actor, status, subtotalMinor: 10000, discountPercent: 0, discountMinor: 0, totalMinor: 10000,
    } });
    for (const action of Object.keys(allowed)) {
      if (allowed[action].includes(status)) continue;
      const snapshot = await storedState(order.id);
      assert.equal((await act(order.id, action, action === 'cancel' ? actor : 'test-manager')).status, 409, `${status}: ${action}`);
      assert.deepEqual(await storedState(order.id), snapshot);
    }
  }
});
test('an expired award is reversed by its original amount without subtracting recent points', async () => {
  const order = await place();
  await db.pointsEntry.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - 91 * 86400000) } });
  await historicalAward(1000);
  const response = await act(order.id, 'cancel', actor);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).loyalty, { points: 1000, tier: 'SILVER' });
  assert.equal((await db.pointsEntry.findFirstOrThrow({ where: { orderId: order.id, kind: 'REVERSAL' } })).pointsDelta, -12);
});
test('late event failure rolls back approval status, points and tier', async () => {
  await historicalAward(990);
  await db.distributor.update({ where: { id: actor }, data: { creditLimitMinor: 0 } });
  const order = await place();
  const snapshot = await storedState(order.id);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_event_insert BEFORE INSERT ON "OrderEvent" BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try { assert.equal((await act(order.id, 'approve')).status, 500); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER fail_event_insert'); }
  assert.deepEqual(await storedState(order.id), snapshot);
});
test('late event failure rolls back cancellation release, reversal and tier', async () => {
  const order = await place();
  const snapshot = await storedState(order.id);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_event_insert BEFORE INSERT ON "OrderEvent" BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try { assert.equal((await act(order.id, 'cancel', actor)).status, 500); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER fail_event_insert'); }
  assert.deepEqual(await storedState(order.id), snapshot);
});
test('inconsistent later inventory line rolls back earlier dispatch deduction and status', async () => {
  const response = await request('/orders', actor, { items: [{ productId: product, quantity: 1 }, { productId: last, quantity: 1 }] });
  const order = await response.json();
  await db.product.update({ where: { id: last }, data: { reservedQuantity: 0 } });
  const snapshot = await storedState(order.id);
  const failed = await act(order.id, 'dispatch');
  assert.equal(failed.status, 409); assert.equal((await failed.json()).error.code, 'INVENTORY_INCONSISTENT');
  assert.deepEqual(await storedState(order.id), snapshot);
});

afterEach(async () => {
  const events = await db.orderEvent.findMany({ include: { outbox: true, order: true } });
  assert.equal(await db.erpOutbox.count(), events.length);
  for (const event of events) {
    assert.ok(event.outbox, 'Every successful transition has one outbox record');
    assert.deepEqual(JSON.parse(event.outbox.payloadJson), {
      eventId: event.id, orderId: event.orderId, distributorId: event.order.distributorId,
      previousStatus: event.fromStatus, newStatus: event.toStatus,
      actor: { type: event.actorType, userId: event.actorUserId }, timestamp: event.createdAt.toISOString(),
    });
  }
});
test('outbox insertion failure rolls back the status event and all placement effects', async () => {
  const orderCount = await db.order.count();
  const eventCount = await db.orderEvent.count();
  const outboxCount = await db.erpOutbox.count();
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON "ErpOutbox" BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try { assert.equal((await request('/orders', actor, orderBody())).status, 500); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER fail_outbox_insert'); }
  assert.equal(await db.order.count(), orderCount);
  assert.equal(await db.orderEvent.count(), eventCount);
  assert.equal(await db.erpOutbox.count(), outboxCount);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
  assert.equal(await db.pointsEntry.count({ where: { distributorId: actor } }), 0);
});
test('outbox insertion failure rolls back lifecycle stock, points, tier and event', async () => {
  const order = await place();
  const snapshot = await storedState(order.id);
  const outboxCount = await db.erpOutbox.count();
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON "ErpOutbox" BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try { assert.equal((await act(order.id, 'cancel', actor)).status, 500); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER fail_outbox_insert'); }
  assert.deepEqual(await storedState(order.id), snapshot);
  assert.equal(await db.erpOutbox.count(), outboxCount);
});
test('one status event cannot have duplicate outbox records', async () => {
  const order = await place();
  const row = await db.erpOutbox.findFirstOrThrow({ where: { orderEvent: { orderId: order.id } } });
  await assert.rejects(db.erpOutbox.create({ data: { orderEventId: row.orderEventId, payloadJson: row.payloadJson } }));
  assert.equal(await db.erpOutbox.count({ where: { orderEventId: row.orderEventId } }), 1);
});

async function keyedPlacement(key: string, user = actor, endpoint = base, body: unknown = orderBody()) {
  return fetch(`${endpoint}/orders`, { method: 'POST', headers: { 'x-user-id': user, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function withSecondApi(run: (endpoint: string) => Promise<void>) {
  // Independent Prisma connection and HTTP server: this exercises SQLite locking,
  // not merely serialized operations on a single Prisma connection.
  const secondDb = new PrismaClient({ datasources: { db: { url: `file:${join(directory, 'test.db')}` } } });
  const secondServer = createApp(secondDb).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => secondServer.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(secondServer.address() as AddressInfo).port}/api`); }
  finally {
    await new Promise<void>((resolve, reject) => secondServer.close(error => error ? reject(error) : resolve()));
    await secondDb.$disconnect();
  }
}
test('same distributor/key replays one order, reservation, award and ERP event', async () => {
  const firstResponse = await keyedPlacement('same-key');
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  const snapshot = await storedState(first.id);
  const replayResponse = await keyedPlacement('same-key');
  assert.equal(replayResponse.status, 201);
  assert.deepEqual(await replayResponse.json(), first);
  assert.deepEqual(await storedState(first.id), snapshot);
  assert.equal(await db.order.count({ where: { distributorId: actor } }), 1);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 1);
  assert.equal(await db.pointsEntry.count({ where: { orderId: first.id } }), 1);
  assert.equal(await db.erpOutbox.count({ where: { orderEvent: { orderId: first.id } } }), 1);
  await assert.rejects(db.order.create({ data: {
    distributorId: actor, idempotencyKey: 'same-key', subtotalMinor: 0, discountPercent: 0, discountMinor: 0, totalMinor: 0,
  } }));
});
test('same key used by different distributors creates distinct orders', async () => {
  const firstResponse = await keyedPlacement('shared-key');
  const secondResponse = await keyedPlacement('shared-key', other);
  assert.equal(firstResponse.status, 201); assert.equal(secondResponse.status, 201);
  const first = await firstResponse.json(); const second = await secondResponse.json();
  assert.notEqual(first.id, second.id); assert.notEqual(first.distributorId, second.distributorId);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 2);
});
test('concurrent duplicate keys on independent connections reserve and award once', async () => {
  await withSecondApi(async endpoint => {
    const body = { items: [{ productId: last, quantity: 1 }] };
    const responses = await Promise.all([keyedPlacement('concurrent-key', actor, base, body), keyedPlacement('concurrent-key', actor, endpoint, body)]);
    assert.deepEqual(responses.map(response => response.status), [201, 201]);
    const [first, second] = await Promise.all(responses.map(response => response.json()));
    assert.equal(first.id, second.id);
    assert.equal(await db.order.count({ where: { distributorId: actor } }), 1);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: last } })).reservedQuantity, 1);
    assert.equal(await db.pointsEntry.count({ where: { orderId: first.id } }), 1);
    assert.equal(await db.erpOutbox.count({ where: { orderEvent: { orderId: first.id } } }), 1);
  });
});
test('two independent connections competing for final unit yield one success and one stock error', async () => {
  await withSecondApi(async endpoint => {
    const body = JSON.stringify({ items: [{ productId: last, quantity: 1 }] });
    const responses = await Promise.all([
      fetch(`${base}/orders`, { method: 'POST', headers: { 'x-user-id': actor, 'Content-Type': 'application/json' }, body }),
      fetch(`${endpoint}/orders`, { method: 'POST', headers: { 'x-user-id': other, 'Content-Type': 'application/json' }, body }),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const failed = responses.find(response => response.status === 409)!;
    assert.deepEqual((await failed.json()).error, { code: 'INSUFFICIENT_STOCK', message: 'Insufficient available stock', sku: last, availableQuantity: 0 });
    const stock = await db.product.findUniqueOrThrow({ where: { id: last } });
    assert.equal(stock.stockQuantity, 1); assert.equal(stock.reservedQuantity, 1);
    assert.ok(stock.reservedQuantity <= stock.stockQuantity);
    assert.equal(await db.order.count({ where: { items: { some: { productId: last } } } }), 1);
  });
});
test('replays keep original financial snapshots despite changed payload or later lifecycle', async () => {
  const first = await (await keyedPlacement('snapshot-key')).json();
  await db.product.update({ where: { id: product }, data: { unitPriceMinor: 150000 } });
  assert.equal((await act(first.id, 'cancel', actor)).status, 200);
  const replay = await (await keyedPlacement('snapshot-key', actor, base, orderBody(10))).json();
  assert.equal(replay.id, first.id); assert.equal(replay.status, 'Cancelled');
  assert.equal(replay.totalMinor, first.totalMinor); assert.equal(replay.items[0].quantity, 1); assert.equal(replay.items[0].unitPriceMinor, 125000);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product } })).reservedQuantity, 0);
  assert.equal(await db.order.count({ where: { distributorId: actor } }), 1);
});
test('failed keyed placement does not consume key; no-header orders remain independent', async () => {
  const unavailable = { items: [{ productId: zero, quantity: 1 }] };
  assert.equal((await keyedPlacement('retry-key', actor, base, unavailable)).status, 409);
  assert.equal((await keyedPlacement('retry-key')).status, 201);
  const first = await place(); const second = await place();
  assert.notEqual(first.id, second.id);
  assert.equal(await db.order.count({ where: { distributorId: actor } }), 3);
  assert.equal((await keyedPlacement('   ')).status, 400);
});
test('event log rejects update/delete at database and API levels', async () => {
  const order = await place(); const event = order.events[0];
  const snapshot = await storedState(order.id);
  await assert.rejects(db.orderEvent.update({ where: { id: event.id }, data: { actorType: 'USER', actorUserId: actor } }));
  await assert.rejects(db.orderEvent.delete({ where: { id: event.id } }));
  for (const method of ['PATCH', 'DELETE']) {
    assert.equal((await fetch(`${base}/orders/${order.id}/events/${event.id}`, { method, headers: { 'x-user-id': 'test-manager' } })).status, 404);
  }
  assert.deepEqual(await storedState(order.id), snapshot);
});
for (const [points, tier] of [[0, 'BRONZE'], [999, 'BRONZE'], [1000, 'SILVER'], [4999, 'SILVER'], [5000, 'GOLD']] as const) {
  test(`loyalty threshold: ${points} recent points gives ${tier}`, async () => {
    if (points) await historicalAward(points);
    await db.distributor.update({ where: { id: actor }, data: { tier: 'GOLD' } });
    const profile = await (await request('/distributors/me')).json();
    assert.equal(profile.points, points); assert.equal(profile.tier, tier);
    assert.equal((await db.distributor.findUniqueOrThrow({ where: { id: actor } })).tier, tier);
  });
}
test('90-day cutoff is inclusive; one millisecond older and future awards are excluded', async () => {
  await historicalAward(1000);
  const award = await db.pointsEntry.findFirstOrThrow({ where: { distributorId: actor } });
  const now = new Date('2026-10-01T12:00:00.000Z');
  const cutoff = new Date(now.getTime() - 90 * 86400000);
  await db.pointsEntry.update({ where: { id: award.id }, data: { createdAt: cutoff } });
  assert.deepEqual(await db.$transaction(tx => refreshLoyalty(tx, actor, now)), { points: 1000, tier: 'SILVER' });
  await db.pointsEntry.update({ where: { id: award.id }, data: { createdAt: new Date(cutoff.getTime() - 1) } });
  assert.deepEqual(await db.$transaction(tx => refreshLoyalty(tx, actor, now)), { points: 0, tier: 'BRONZE' });
  await db.pointsEntry.update({ where: { id: award.id }, data: { createdAt: new Date(now.getTime() + 1) } });
  assert.deepEqual(await db.$transaction(tx => refreshLoyalty(tx, actor, now)), { points: 0, tier: 'BRONZE' });
});
