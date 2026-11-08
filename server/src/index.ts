import { env } from './config/env.js';
import { connectWithRetry, prisma } from './db.js';
import { getProvider } from './engine/index.js';
import { createApp } from './app.js';
import { startKeepAlive } from './keepAlive.js';

const FORCED_EXIT_MS = 10_000;

process.on('unhandledRejection', (reason) => {
  console.error('[api] unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[api] uncaught exception, exiting:', err);
  process.exit(1);
});

async function main() {
  getProvider(env.RECOMMENDER); // fail fast on a bad RECOMMENDER value
  await connectWithRetry();
  const server = createApp().listen(env.PORT, env.host, (err?: Error) => {
    if (err) {
      console.error(`[api] cannot listen on ${env.host}:${env.PORT}:`, err.message);
      process.exit(1);
    }
    console.log(`[api] listening on http://${env.host}:${env.PORT} (${env.NODE_ENV}, recommender: ${env.RECOMMENDER})`);
  });
  // Render free plan: ping our own public URL so the service never sleeps (off when not on Render).
  const keepAlive = env.keepAliveUrl ? startKeepAlive({ url: env.keepAliveUrl, everyMs: env.KEEP_ALIVE_MINUTES * 60_000 }) : null;
  // Longer than a load balancer's idle timeout (often 60 s), so it never reuses a socket we just closed.
  server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = env.HEADERS_TIMEOUT_MS;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal}: shutting down…`);
    keepAlive?.stop();
    setTimeout(() => {
      console.error(`[api] still busy after ${FORCED_EXIT_MS / 1000}s, exiting anyway`);
      process.exit(1);
    }, FORCED_EXIT_MS).unref();
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
