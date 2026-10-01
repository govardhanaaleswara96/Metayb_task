const fs = require('node:fs');
const path = require('node:path');
const url = process.env.DATABASE_URL ?? 'file:./dev.db';
if (!url.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL');
const dbPath = path.resolve('prisma', url.slice(5));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
// Prisma 6 migrate deploy requires the SQLite file to exist on this setup.
fs.closeSync(fs.openSync(dbPath, 'a'));
