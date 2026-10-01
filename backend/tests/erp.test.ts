import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { processErpOutbox, terminalAttemptAt } from '../src/integrations/erp';
import { recordOrderEvent } from '../src/integrations/orderEvents';
let db: PrismaClient;
let directory: string;
let rowId: string;
let clock: Date;
const now = () => clock;
const url = 'http://127.0.0.1:5050/events';
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'metayb-erp-'));
  const path = join(directory, 'test.db'); writeFileSync(path, '');
  const databaseUrl = `file:${path}`;
  execFileSync(process.execPath, [resolve('../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.user.create({ data: { id: 'distributor', name: 'Distributor', role: 'DISTRIBUTOR', distributor: { create: { id: 'distributor', creditLimitMinor: 500000 } } } });
});
after(async () => { if (db) await db.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); });
beforeEach(async () => {
  clock = new Date('2026-10-01T00:00:00.000Z');
  await db.erpOutbox.updateMany({ data: { sentAt: clock } });
  const order = await db.order.create({ data: { distributorId: 'distributor', status: 'Confirmed', subtotalMinor: 10000, discountPercent: 0, discountMinor: 0, totalMinor: 10000 } });
  const event = await db.$transaction(tx => recordOrderEvent(tx, { orderId: order.id, distributorId: 'distributor', fromStatus: 'Placed', toStatus: 'Confirmed', actorType: 'SYSTEM', createdAt: clock }));
  rowId = (await db.erpOutbox.findUniqueOrThrow({ where: { orderEventId: event.id } })).id;
});
const row = () => db.erpOutbox.findUniqueOrThrow({ where: { id: rowId } });
test('HTTP JSON delivery marks sent and repeated processing does not resend', async () => {
  let calls = 0; let payload: unknown;
  const receiver = createServer((request, response) => {
    calls++; assert.equal(request.method, 'POST'); assert.equal(request.headers['content-type'], 'application/json');
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => { payload = JSON.parse(body); response.writeHead(202); response.end(); });
  });
  receiver.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => receiver.once('listening', resolve));
  try {
    const endpoint = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/events`;
    await processErpOutbox(db, { url: endpoint, now });
    const delivered = await row();
    assert.deepEqual(payload, JSON.parse(delivered.payloadJson));
    assert.equal(delivered.sentAt?.getTime(), clock.getTime()); assert.equal(delivered.attemptCount, 1); assert.equal(delivered.lastError, null);
    await processErpOutbox(db, { url: endpoint, now }); assert.equal(calls, 1);
  } finally { await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve())); }
});
test('5xx retries exponentially, respects due dates, and eventually succeeds', async () => {
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response(null, { status: calls < 3 ? 503 : 200 }); };
  await processErpOutbox(db, { url, now, send });
  let failed = await row(); assert.equal(failed.attemptCount, 1); assert.equal(failed.nextAttemptAt.getTime(), clock.getTime() + 1000); assert.equal(failed.lastError, 'HTTP 503');
  await processErpOutbox(db, { url, now, send }); assert.equal(calls, 1);
  clock = failed.nextAttemptAt; await processErpOutbox(db, { url, now, send });
  failed = await row(); assert.equal(failed.attemptCount, 2); assert.equal(failed.nextAttemptAt.getTime(), clock.getTime() + 2000);
  clock = failed.nextAttemptAt; await processErpOutbox(db, { url, now, send });
  assert.ok((await row()).sentAt); assert.equal((await row()).attemptCount, 3); assert.equal((await row()).lastError, null);
});
test('timeout aborts the request and schedules exponential retries', async () => {
  const send: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await processErpOutbox(db, { url, now, send, timeoutMs: 10 });
  let failed = await row(); assert.equal(failed.sentAt, null); assert.equal(failed.lastError, 'Timeout after 10ms');
  assert.equal(failed.nextAttemptAt.getTime(), clock.getTime() + 1000);
  clock = failed.nextAttemptAt; await processErpOutbox(db, { url, now, send, timeoutMs: 10 });
  failed = await row(); assert.equal(failed.attemptCount, 2); assert.equal(failed.nextAttemptAt.getTime(), clock.getTime() + 2000);
});
test('ordinary 4xx is parked permanently and not retried', async () => {
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response(null, { status: 400 }); };
  await processErpOutbox(db, { url, now, send });
  const failed = await row(); assert.equal(failed.sentAt, null); assert.equal(failed.nextAttemptAt.getTime(), terminalAttemptAt.getTime()); assert.equal(failed.lastError, 'Permanent failure: HTTP 400');
  clock = new Date(clock.getTime() + 86400000); await processErpOutbox(db, { url, now, send }); assert.equal(calls, 1);
});
test('network failures retry and retry delay is capped', async () => {
  await db.erpOutbox.update({ where: { id: rowId }, data: { attemptCount: 20 } });
  const send: typeof fetch = async () => { throw new Error('connection refused'); };
  await processErpOutbox(db, { url, now, send });
  const failed = await row(); assert.equal(failed.attemptCount, 21); assert.equal(failed.nextAttemptAt.getTime(), clock.getTime() + 60000); assert.match(failed.lastError!, /connection refused/);
});
test('concurrent processing claims one event once', async () => {
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response(null, { status: 200 }); };
  await Promise.all([processErpOutbox(db, { url, now, send }), processErpOutbox(db, { url, now, send })]);
  assert.equal(calls, 1); assert.ok((await row()).sentAt); assert.equal((await row()).attemptCount, 1);
});
test('an expired sender lease is recovered after a simulated crash', async () => {
  await db.erpOutbox.update({ where: { id: rowId }, data: { nextAttemptAt: new Date(clock.getTime() + 1000), attemptCount: 1 } });
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response(null, { status: 200 }); };
  await processErpOutbox(db, { url, now, send }); assert.equal(calls, 0);
  clock = new Date(clock.getTime() + 1000); await processErpOutbox(db, { url, now, send });
  assert.equal(calls, 1); assert.equal((await row()).attemptCount, 2); assert.ok((await row()).sentAt);
});
