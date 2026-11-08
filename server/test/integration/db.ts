/**
 * A throwaway PostgreSQL for integration tests: a fresh embedded-postgres cluster in a new folder under the OS temp
 * directory, on a free port from 5434 up (never the live 5433), migrated with `prisma migrate deploy` and optionally
 * seeded with `prisma/seed.ts`. `stop()` kills the cluster and deletes its folder; a synchronous fallback does the same
 * if the process exits without calling it.
 *
 * Nothing here reads server/.env secrets: the database password, JWT secret and admin login are generated per run.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** server/ (this file is server/test/integration/db.ts). */
export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The live system and an unrelated app: never used, whatever TEST_PG_PORT says. */
const RESERVED_PORTS = new Set([4000, 5173, 5180, 5433]);
const DB_NAME = 'pouchwale_test';
const HOST = '127.0.0.1';

export interface TestDb {
  /** postgresql://… for this cluster's test database. */
  url: string;
  port: number;
  /** The temp folder holding the cluster (deleted by stop()). */
  dir: string;
  /** The seeded ADMIN account (only meaningful when seeded). */
  admin: { email: string; password: string };
  /** Run SQL as the superuser on the test database (setup tricks such as constraints). */
  sql(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Kill Postgres and delete the folder. Idempotent. */
  stop(): Promise<void>;
  readonly stopped: boolean;
}

export interface StartOptions {
  /** Run prisma/seed.ts (default true). */
  seed?: boolean;
  /** Durability off (fsync, synchronous_commit, full_page_writes): faster tests. Default true. */
  fast?: boolean;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: HOST, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** A free port from `start` up, skipping the reserved ones. */
export async function findFreePort(start = Number(process.env.TEST_PG_PORT ?? 5434), tries = 100): Promise<number> {
  for (let port = start; port < start + tries; port++) {
    if (RESERVED_PORTS.has(port)) continue;
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port in ${start}–${start + tries - 1}`);
}

/** Commands that must never see the live database: only our URL, our admin, our secrets. */
function childEnv(url: string, admin: { email: string; password: string }): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: url, ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: admin.password, NODE_ENV: 'development' };
}

function run(command: string, env: NodeJS.ProcessEnv): string {
  try {
    return execSync(command, { cwd: SERVER_DIR, env, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${command} failed: ${e.message}\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
}

export async function startTestDb(options: StartOptions = {}): Promise<TestDb> {
  const { seed = true, fast = true } = options;
  const dir = mkdtempSync(path.join(tmpdir(), 'pw-itest-'));
  const dataDir = path.join(dir, 'data');
  const password = randomBytes(16).toString('hex');
  const admin = { email: 'itest-admin@example.com', password: `It-${randomBytes(12).toString('hex')}` };
  let pg: EmbeddedPostgres | undefined;
  let stopped = false;
  let removed = false;

  /** embedded-postgres keeps the postmaster ChildProcess private. */
  const postmaster = () => (pg as unknown as { process?: ChildProcess } | undefined)?.process;
  /** pg_ctl next to the postgres binary the cluster was started with. */
  const pgCtl = () => {
    const bin = postmaster()?.spawnfile;
    return bin ? path.join(path.dirname(bin), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl') : undefined;
  };

  /** Synchronous last resort (process 'exit'): stop the cluster (if still running) and delete the folder. */
  const killSync = () => {
    const proc = stopped ? undefined : postmaster();
    const pid = proc && proc.exitCode === null ? proc.pid : undefined;
    stopped = true;
    if (pid) {
      const ctl = pgCtl();
      if (ctl) spawnSync(ctl, ['stop', '-D', dataDir, '-m', 'immediate', '-w', '-t', '10'], { stdio: 'ignore' });
    }
    if (pid && postmaster()?.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
      else {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    if (removed) return;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // best effort on exit
    }
  };
  process.once('exit', killSync);

  /** Windows may hold file handles for a few seconds after taskkill: retry for up to ~30 s. */
  const removeDir = async () => {
    for (let attempt = 1; !removed; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        removed = true;
      } catch (err) {
        if (attempt >= 60) throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  };

  /**
   * A clean "fast" shutdown with pg_ctl: the postmaster ends its own children and closes its listening socket.
   * (`taskkill /f /t`, which embedded-postgres' stop() uses on Windows, once missed a just-forked child that kept the
   * inherited listening socket open, so a client hung on it.) taskkill only as a fallback.
   */
  const shutdown = async () => {
    const proc = postmaster();
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    const ctl = pgCtl();
    if (ctl) {
      await new Promise<void>((resolve) => {
        const c = spawn(ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '20'], { stdio: 'ignore' });
        c.once('error', () => resolve());
        c.once('exit', () => resolve());
      });
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    if (proc.exitCode === null && proc.signalCode === null) await pg!.stop().catch(() => {});
  };

  const stop = async () => {
    if (!stopped) {
      stopped = true;
      await shutdown();
    }
    // Calling stop() again retries a removal that failed; the exit fallback stays until the folder is gone.
    await removeDir();
    process.removeListener('exit', killSync);
  };

  try {
    const flags = ['-c', `listen_addresses=${HOST}`];
    if (fast) flags.push('-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off');
    let port = await findFreePort();
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      port,
      user: 'postgres',
      password,
      persistent: true, // we delete the folder ourselves (with retries)
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: flags,
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    // Another run may grab the same free port between the check and the bind: retry on the next one.
    for (let attempt = 1; ; attempt++) {
      try {
        await pg.start();
        break;
      } catch (err) {
        if (attempt >= 5) throw new Error(`embedded Postgres did not start (last port ${port})`, { cause: err });
        port = await findFreePort(port + 1);
        (pg as unknown as { options: { port: number } }).options.port = port;
      }
    }

    const client = pg.getPgClient('postgres', HOST);
    await client.connect();
    await client.query(`CREATE DATABASE "${DB_NAME}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    await client.end();

    const url = `postgresql://postgres:${password}@${HOST}:${port}/${DB_NAME}`;
    const env = childEnv(url, admin);
    const out = run('npx prisma migrate deploy', env);
    // Belt and braces: Prisma must have used our URL, not server/.env's.
    if (!out.includes(`${HOST}:${port}`) || !out.includes(DB_NAME)) {
      throw new Error(`prisma migrate deploy did not target the test database:\n${out}`);
    }
    if (seed) run('npx tsx prisma/seed.ts', env);

    const sql = async (text: string, params?: unknown[]) => {
      const c = pg!.getPgClient(DB_NAME, HOST);
      await c.connect();
      try {
        const res = await c.query(text, params as unknown[]);
        return { rows: res.rows as Record<string, unknown>[] };
      } finally {
        await c.end();
      }
    };

    return {
      url,
      port,
      dir,
      admin,
      sql,
      stop,
      get stopped() {
        return stopped;
      },
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
