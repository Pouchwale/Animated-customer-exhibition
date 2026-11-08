/**
 * Readiness with no database at all: Prisma pointed at a closed local port. No Postgres is started.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { findFreePort } from './db.js';

let server: Server;
let port: number;
let disconnect: () => Promise<void>;

before(async () => {
  port = await findFreePort(5600); // free = nothing listens there
  process.env.DATABASE_URL = `postgresql://nobody:nothing@127.0.0.1:${port}/nothing?connect_timeout=2`;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.NODE_ENV = 'test';
  const [{ createApp }, { prisma }] = await Promise.all([import('../../src/app.js'), import('../../src/db.js')]);
  disconnect = () => prisma.$disconnect();
  server = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
});
after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await disconnect?.().catch(() => {});
});

describe('database unreachable', () => {
  it('/api/health still answers 200', async () => {
    const res = await request(server).get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  it('/api/ready answers 503 {ok: false} within its 2 s budget', { timeout: 30_000 }, async () => {
    const t0 = Date.now();
    const res = await request(server).get('/api/ready');
    const ms = Date.now() - t0;
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { ok: false });
    assert.ok(ms < 3000, `answered in ${ms} ms`);
  });

  it('data routes answer a generic 500 that names no host, port or user', { timeout: 30_000 }, async () => {
    for (const req of [request(server).get('/api/parameters'), request(server).post('/api/suggestions').send({ priorities: [{ key: 'price', label: 'Price' }] })]) {
      const res = await req;
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: 'Something went wrong. Please try again.' });
      assert.doesNotMatch(JSON.stringify(res.body), new RegExp(`${port}|127\\.0\\.0\\.1|nobody`));
    }
  });
});
