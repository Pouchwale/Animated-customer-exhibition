import { PrismaClient } from '@prisma/client';
import './config/env.js'; // loads server/.env before Prisma reads DATABASE_URL

// Not 'error': Prisma would log every handled failure too (409s, 404s) and the database host when it's down.
export const prisma = new PrismaClient({ log: ['warn'] });

/** Connect at startup, retrying while the database comes up (e.g. embedded Postgres). */
export async function connectWithRetry(attempts = 30, delayMs = 2000): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`[db] not reachable yet (attempt ${i}/${attempts}), retrying in ${delayMs / 1000}s…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
