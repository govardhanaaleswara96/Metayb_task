import { app } from './app';
import { prisma } from './db';
import { startErpWorker } from './integrations/erp';
const port = Number(process.env.PORT ?? 5001);
async function start() {
  await prisma.$connect();
  const stopErp = process.env.ERP_URL ? startErpWorker(prisma, process.env.ERP_URL) : async () => {};
  if (!process.env.ERP_URL) console.log('ERP_URL is unset: events remain queued for delivery.');
  const server = app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
  const stop = () => server.close(() => { void stopErp().then(() => prisma.$disconnect()).then(() => process.exit(0)); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
void start().catch(async error => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });

