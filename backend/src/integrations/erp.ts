import { PrismaClient } from '@prisma/client';
// With the existing schema, a far-future due date parks permanent failures.
export const terminalAttemptAt = new Date('9999-12-31T00:00:00.000Z');
interface SenderOptions {
  url: string; timeoutMs?: number; baseDelayMs?: number; maxDelayMs?: number;
  now?: () => Date; send?: typeof fetch;
}
export async function processErpOutbox(db: PrismaClient, options: SenderOptions) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? (() => new Date());
  const due = await db.erpOutbox.findMany({ where: { sentAt: null, nextAttemptAt: { lte: now() } }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 25 });
  for (const row of due) {
    const attemptCount = row.attemptCount + 1;
    const lease = new Date(now().getTime() + timeoutMs + 30000);
    // Claim before HTTP. A crashed sender leaves a recoverable lease, not a lost event.
    const claimed = await db.erpOutbox.updateMany({
      where: { id: row.id, sentAt: null, attemptCount: row.attemptCount, nextAttemptAt: { lte: now() } },
      data: { attemptCount, nextAttemptAt: lease },
    });
    if (claimed.count !== 1) continue;
    let error: string | null = null;
    let permanent = false;
    let success = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (options.send ?? fetch)(options.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: row.payloadJson,
        signal: controller.signal, redirect: 'manual',
      });
      success = response.status >= 200 && response.status < 300;
      if (!success) {
        error = `HTTP ${response.status}`;
        permanent = response.status < 500;
      }
      await response.body?.cancel();
    } catch (failure) {
      error = controller.signal.aborted ? `Timeout after ${timeoutMs}ms` : `Network error: ${failure instanceof Error ? failure.message : String(failure)}`;
    } finally { clearTimeout(timeout); }
    const finished = now();
    const delay = Math.min(options.maxDelayMs ?? 60000, (options.baseDelayMs ?? 1000) * 2 ** Math.min(attemptCount - 1, 30));
    await db.erpOutbox.updateMany({
      where: { id: row.id, sentAt: null, attemptCount, nextAttemptAt: lease },
      data: success ? { sentAt: finished, lastError: null } : {
        lastError: permanent ? `Permanent failure: ${error}` : error,
        nextAttemptAt: permanent ? terminalAttemptAt : new Date(finished.getTime() + delay),
      },
    });
  }
}
export function startErpWorker(db: PrismaClient, url: string) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('ERP_URL must use HTTP or HTTPS');
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  function tick() {
    running = processErpOutbox(db, { url }).catch(error => console.error('ERP worker:', error)).finally(() => {
      if (!stopped) timer = setTimeout(tick, 1000);
    });
  }
  tick();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}
