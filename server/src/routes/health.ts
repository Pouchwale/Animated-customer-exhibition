import { Router } from 'express';
import { prisma } from '../db.js';

export const healthRouter = Router();

const READY_TIMEOUT_MS = 2000;

/** Liveness: the process answers. No database access. */
healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** One database check at a time, reused for 1 s: /ready isn't rate limited, so a flood can't tie up the connection pool. */
let lastCheck: { at: number; failure: Promise<string | undefined> } | undefined;

/** Readiness: the database answers `SELECT 1` within 2 s (200), else 503. */
healthRouter.get('/ready', async (_req, res) => {
  if (!lastCheck || Date.now() - lastCheck.at > 1000) lastCheck = { at: Date.now(), failure: checkDatabase() };
  const failure = await lastCheck.failure;
  res.status(failure ? 503 : 200).json({ ok: !failure });
});

/** A failure reason (error code or "timeout"), or undefined when the database answered. */
async function checkDatabase(): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), READY_TIMEOUT_MS);
  });
  const failure = await Promise.race([
    prisma.$queryRaw`SELECT 1`.then(
      () => undefined,
      // Codes only: Prisma messages can name hosts and users.
      (err: { code?: string; errorCode?: string; name?: string } | undefined) => err?.code ?? err?.errorCode ?? err?.name ?? 'error',
    ),
    timedOut,
  ]).finally(() => clearTimeout(timer));
  if (failure) console.warn(`[ready] database check failed: ${failure}`);
  return failure;
}
