/** Waits until DATABASE_URL accepts connections (max 120s). Used by `npm run dev:all`. */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[wait-for-db] DATABASE_URL is not set');
  process.exit(1);
}

const deadline = Date.now() + 120_000;
for (;;) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    console.log('[wait-for-db] database is up');
    process.exit(0);
  } catch {
    await client.end().catch(() => {});
    if (Date.now() > deadline) {
      console.error('[wait-for-db] timed out after 120s');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
