/**
 * Local development database: a real PostgreSQL server run by `embedded-postgres`
 * (no install needed). Data persists in server/.pgdata.
 *
 *   npm run db        → starts Postgres on port 5433 and keeps it running (Ctrl+C to stop)
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../.pgdata');
const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const DB_NAME = 'pouchwale';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port: PORT,
  user: 'postgres',
  password: 'postgres',
  persistent: true,
  // UTF-8 everywhere, independent of the Windows system locale (otherwise ₹ and Hindi text can't be stored).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (e) => console.error('[db]', e),
});

async function main() {
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log(`[db] initialising new cluster in ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  const { rows } = await client.query(
    'SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1',
    [DB_NAME],
  );
  if (!rows.length) {
    await client.query(`CREATE DATABASE "${DB_NAME}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    console.log(`[db] created database "${DB_NAME}" (UTF-8)`);
  } else if (rows[0].encoding !== 'UTF8') {
    console.warn(`[db] WARNING: database "${DB_NAME}" uses ${rows[0].encoding}, not UTF-8 — text such as ₹ cannot be saved.`);
  }
  await client.end();

  console.log(`[db] ready: postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`);
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('[db] stopping…');
  await pg.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (err) => {
  console.error('[db] failed to start:', err);
  await pg.stop().catch(() => {});
  process.exit(1);
});

// Keep the process alive while Postgres runs.
setInterval(() => {}, 1 << 30);
