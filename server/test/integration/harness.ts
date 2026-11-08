/**
 * Integration harness: a throwaway database (./db.ts), then the real app on it, over HTTP (supertest).
 * The environment is set BEFORE any server module is imported, so server/.env (live DB, live secrets) never applies:
 * real environment variables win over server/.env.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { startTestDb, type StartOptions, type TestDb } from './db.js';

export interface Harness {
  db: TestDb;
  /** supertest bound to the app's own listener on 127.0.0.1:<random>. */
  api: () => ReturnType<typeof request>;
  baseUrl: string;
  prisma: typeof import('../../src/db.js').prisma;
  invalidateSuggestionCache: () => void;
  /** Sign in; returns the `pw_session=…` cookie pair (asserts 200). */
  login(email: string, password: string): Promise<string>;
  /** Create a user straight in the test database. */
  createUser(role: 'ADMIN' | 'EDITOR', email: string, password: string): Promise<{ id: string }>;
  close(): Promise<void>;
}

/** The `pw_session=<jwt>` pair from a response's Set-Cookie, or undefined. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith('pw_session='))?.split(';')[0];
}

/** The full Set-Cookie line for pw_session, or undefined. */
export function sessionSetCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith('pw_session='));
}

export async function startHarness(options: StartOptions = {}): Promise<Harness> {
  const db = await startTestDb(options);
  let server: Server | undefined;
  let prismaRef: Harness['prisma'] | undefined;
  try {
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    delete process.env.HTTPS;
    delete process.env.TRUST_PROXY;

    const [{ createApp }, { prisma }, { invalidateSuggestionCache }, bcrypt] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/db.js'),
      import('../../src/services/suggestions.js'),
      import('bcryptjs'),
    ]);
    prismaRef = prisma;
    // Guard: the app's Prisma client must be on the test database.
    const [{ port }] = await prisma.$queryRaw<{ port: number }[]>`SELECT inet_server_port() AS port`;
    assert.equal(Number(port), db.port, 'Prisma is not connected to the test database');

    const app = createApp();
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port: appPort } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${appPort}`;
    const srv = server;
    const api = () => request(srv);

    const h: Harness = {
      db,
      api,
      baseUrl,
      prisma,
      invalidateSuggestionCache,
      async login(email, password) {
        const res = await api().post('/api/auth/login').send({ email, password });
        assert.equal(res.status, 200, `login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
        const cookie = sessionCookie(res);
        assert.ok(cookie, 'login sets pw_session');
        return cookie;
      },
      async createUser(role, email, password) {
        const passwordHash = await bcrypt.default.hash(password, 4);
        return prisma.adminUser.create({ data: { email, name: `${role} ${email}`, passwordHash, role }, select: { id: true } });
      },
      async close() {
        if (srv.listening) {
          srv.closeAllConnections();
          await new Promise<void>((resolve) => srv.close(() => resolve()));
        }
        await prisma.$disconnect().catch(() => {});
        await db.stop();
      },
    };
    return h;
  } catch (err) {
    if (server?.listening) server.close();
    await prismaRef?.$disconnect().catch(() => {});
    await db.stop();
    throw err;
  }
}
