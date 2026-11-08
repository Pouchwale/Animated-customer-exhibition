/**
 * Runtime tests: config parsing, error mapping, roles, health, request ids, headers and production static serving.
 * No database is needed.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp, type AppConfig } from './app.js';
import { EXAMPLE_JWT_SECRET, findServerDir, parseBool, parseEnv, parseTrustProxy } from './config/env.js';
import { requireRole } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';

const app = createApp();
const SECRET = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8';
const BASE = { DATABASE_URL: 'postgresql://app:pw@db:5432/pouchwale', JWT_SECRET: SECRET };

describe('env parsing', () => {
  it('parses booleans and rejects anything else', () => {
    assert.equal(parseBool('TRUE'), true);
    assert.equal(parseBool(' yes '), true);
    assert.equal(parseBool('0'), false);
    assert.equal(parseBool('off'), false);
    assert.equal(parseBool('maybe'), undefined);
  });

  it('parses TRUST_PROXY as hops, booleans or subnets', () => {
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('0'), 0);
    assert.equal(parseTrustProxy('False'), false);
    assert.equal(parseTrustProxy('true'), true);
    assert.deepEqual(parseTrustProxy('10.0.0.0/8, loopback ,::1,192.168.1.10,172.16.0.0/255.240.0.0'), [
      '10.0.0.0/8',
      'loopback',
      '::1',
      '192.168.1.10',
      '172.16.0.0/255.240.0.0',
    ]);
    for (const bad of ['proxy.example.com', '10.0.0.0/33', '1.2.3.4/8/8', ',', 'yes']) assert.equal(parseTrustProxy(bad), undefined, bad);
  });

  it('development defaults: loopback, no HTTPS, no trusted proxy', () => {
    const r = parseEnv({ ...BASE, NODE_ENV: 'development' }, '/srv/app/server');
    assert.ok(r.ok);
    assert.equal(r.env.host, '127.0.0.1');
    assert.equal(r.env.https, false);
    assert.equal(r.env.cookieSecure, false);
    assert.equal(r.env.trustProxy, false);
    assert.equal(r.env.KEEP_ALIVE_TIMEOUT_MS, 65_000);
    assert.equal(r.env.HEADERS_TIMEOUT_MS, 66_000);
    assert.equal(r.env.RECOMMENDER, 'priority-weighted');
    assert.equal(r.env.clientDist, path.resolve('/srv/app/server', '../client/dist'));
  });

  it('production defaults: all interfaces, HTTPS, one proxy hop; blank values count as unset', () => {
    const r = parseEnv({ ...BASE, NODE_ENV: 'production', HOST: '', HTTPS: ' ', TRUST_PROXY: '' }, '/srv/app/server');
    assert.ok(r.ok);
    assert.equal(r.env.host, '0.0.0.0');
    assert.equal(r.env.https, true);
    assert.equal(r.env.cookieSecure, true);
    assert.equal(r.env.trustProxy, 1);
    assert.deepEqual(r.warnings, []);
  });

  it('explicit values override the defaults', () => {
    const r = parseEnv({ ...BASE, NODE_ENV: 'production', HOST: '192.168.1.5', HTTPS: 'false', TRUST_PROXY: 'loopback' }, '/x');
    assert.ok(r.ok);
    assert.equal(r.env.host, '192.168.1.5');
    assert.equal(r.env.cookieSecure, false);
    assert.deepEqual(r.env.trustProxy, ['loopback']);
  });

  it('accepts the old rule-based recommender and rejects unknown ones', () => {
    assert.ok(parseEnv({ ...BASE, RECOMMENDER: 'rule-based' }, '/x').ok);
    const r = parseEnv({ ...BASE, RECOMMENDER: 'gpt' }, '/x');
    assert.ok(!r.ok);
    assert.match(r.errors.join('\n'), /RECOMMENDER must be one of/);
  });

  it('rejects bad HTTPS, TRUST_PROXY and timeout values', () => {
    const r = parseEnv({ ...BASE, HTTPS: 'sometimes', TRUST_PROXY: 'everyone', KEEP_ALIVE_TIMEOUT_MS: '70000' }, '/x');
    assert.ok(!r.ok);
    const text = r.errors.join('\n');
    assert.match(text, /HTTPS/);
    assert.match(text, /TRUST_PROXY/);
    assert.match(text, /HEADERS_TIMEOUT_MS must be greater/);
  });

  it('production: refuses the example or a low-variety JWT_SECRET, without printing it', () => {
    const example = parseEnv({ ...BASE, NODE_ENV: 'production', JWT_SECRET: EXAMPLE_JWT_SECRET }, '/x');
    assert.ok(!example.ok);
    assert.match(example.errors.join('\n'), /example value/);
    assert.ok(!example.errors.join('\n').includes(EXAMPLE_JWT_SECRET));

    const repetitive = parseEnv({ ...BASE, NODE_ENV: 'production', JWT_SECRET: 'abababababababababababababababab' }, '/x');
    assert.ok(!repetitive.ok);
    assert.match(repetitive.errors.join('\n'), /not random enough/);

    // Development keeps accepting whatever the .env has (16+ characters).
    assert.ok(parseEnv({ ...BASE, JWT_SECRET: EXAMPLE_JWT_SECRET }, '/x').ok);
  });

  it('production: only warns about the example database login', () => {
    const r = parseEnv({ ...BASE, NODE_ENV: 'production', DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/pouchwale' }, '/x');
    assert.ok(r.ok);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /example postgres\/postgres login/);
  });

  it('finds the server package folder from src/config', () => {
    const dir = findServerDir(path.join(import.meta.dirname, 'config'));
    assert.ok(dir);
    assert.equal(path.basename(dir), 'server');
    assert.equal(findServerDir(tmpdir()), undefined);
  });
});

/** A tiny app whose routes throw the given errors through the real error handler. */
function throwing(errors: Record<string, unknown>) {
  const a = express();
  for (const [name, err] of Object.entries(errors))
    a.get(`/${name}`, () => {
      throw err;
    });
  a.use(errorHandler);
  return a;
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`Prisma error ${code}`, { code, clientVersion: Prisma.prismaVersion.client, meta });

describe('error mapping', () => {
  const errApp = throwing({
    p2002: prismaError('P2002', { target: ['suggestionParameterId', 'label'] }),
    p2002bare: prismaError('P2002', { target: 'Parameter_key_key' }),
    p2025: prismaError('P2025'),
    p2034: prismaError('P2034'),
    boom: new Error('secret internals at C:\\app\\x.ts'),
    // An exposed 4xx that did not come from the body parser (e.g. a missing file): its message must not leak.
    file: Object.assign(new Error("ENOENT: no such file or directory, stat 'C:\\app\\index.html'"), { status: 404, expose: true }),
  });

  it('P2002 → 409 with { path, message } details per field', async () => {
    const res = await request(errApp).get('/p2002');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'A record with this value already exists');
    assert.deepEqual(res.body.details, [
      { path: 'suggestionParameterId', message: 'This value is already in use.' },
      { path: 'label', message: 'This value is already in use.' },
    ]);
    const bare = await request(errApp).get('/p2002bare');
    assert.equal(bare.status, 409);
    assert.deepEqual(bare.body, { error: 'A record with this value already exists' });
  });

  it('P2025 → 404, P2034 → 409 "Please try again"', async () => {
    assert.deepEqual((await request(errApp).get('/p2025')).body, { error: 'Not found' });
    const conflict = await request(errApp).get('/p2034');
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: 'Please try again' });
  });

  it('unexpected errors → generic 500 without stack or message, logged with method and path only', async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    for (const url of ['/boom?token=abc', '/file']) {
      const res = await request(errApp).get(url);
      assert.equal(res.status, 500, url);
      assert.deepEqual(res.body, { error: 'Something went wrong. Please try again.' });
      assert.ok(!res.text.includes('C:\\'), url);
    }
    const first = String(logged.mock.calls[0].arguments[0]);
    assert.match(first, /GET \/boom /);
    assert.ok(!first.includes('token'));
  });

  it('body too large → 413', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ priorities: [], pad: 'x'.repeat(120 * 1024) }));
    assert.equal(res.status, 413);
    assert.deepEqual(res.body, { error: 'Request body is too large' });
  });

  it('exposed body-parser errors keep their 4xx status and message', async () => {
    const charset = await request(app).post('/api/suggestions').set('Content-Type', 'application/json; charset=latin1').send('{}');
    assert.equal(charset.status, 415);
    assert.deepEqual(charset.body, { error: 'unsupported charset "LATIN1"' });

    const encoding = await request(app)
      .post('/api/suggestions')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{}');
    assert.equal(encoding.status, 415);
    assert.match(encoding.body.error, /unsupported content encoding/);

    // A body that claims brotli but is not: the client's fault (400), not ours.
    const brotli = await request(app)
      .post('/api/suggestions')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'br')
      .send('not brotli');
    assert.equal(brotli.status, 400);
    assert.equal(typeof brotli.body.error, 'string');
  });
});

describe('roles', () => {
  const roleApp = (role: string, min: 'EDITOR' | 'ADMIN') => {
    const a = express();
    a.get(
      '/x',
      (_req, res, next) => {
        res.locals.user = { id: 'u1', email: 'u@example.com', name: 'U', role: role as 'ADMIN' };
        next();
      },
      requireRole(min),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    a.use(errorHandler);
    return a;
  };

  it('fails closed for an unknown role', async () => {
    assert.equal((await request(roleApp('OWNER', 'EDITOR')).get('/x')).status, 403);
    assert.equal((await request(roleApp('', 'EDITOR')).get('/x')).status, 403);
  });

  it('still ranks the known roles', async () => {
    assert.equal((await request(roleApp('ADMIN', 'EDITOR')).get('/x')).status, 200);
    assert.equal((await request(roleApp('EDITOR', 'EDITOR')).get('/x')).status, 200);
    assert.equal((await request(roleApp('EDITOR', 'ADMIN')).get('/x')).status, 403);
  });
});

describe('health, request ids and headers', () => {
  it('GET /api/health is a plain liveness check', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  it('gives every response an X-Request-Id, keeping a sane incoming one', async () => {
    const fresh = await request(app).get('/api/health');
    assert.match(fresh.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    const kept = await request(app).get('/api/health').set('X-Request-Id', 'lb-1234.abc');
    assert.equal(kept.headers['x-request-id'], 'lb-1234.abc');
    for (const bad of ['has space', 'x'.repeat(200), '<script>']) {
      const res = await request(app).get('/api/does-not-exist').set('X-Request-Id', bad);
      assert.notEqual(res.headers['x-request-id'], bad);
      assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    }
  });

  it('plain HTTP: no HSTS and no upgrade-insecure-requests; HTTPS: both', async () => {
    const http = await request(createApp({ isProduction: false, https: false, trustProxy: false, clientDist: '/none' })).get('/api/health');
    assert.equal(http.headers['strict-transport-security'], undefined);
    assert.ok(!http.headers['content-security-policy'].includes('upgrade-insecure-requests'));
    assert.match(http.headers['content-security-policy'], /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);

    const https = await request(createApp({ isProduction: false, https: true, trustProxy: false, clientDist: '/none' })).get('/api/health');
    assert.match(https.headers['strict-transport-security'], /max-age=/);
    assert.match(https.headers['content-security-policy'], /upgrade-insecure-requests/);
  });
});

describe('production static serving', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'pw-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>PW</title>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'logo-pink.png'), 'png');
  after(() => rmSync(dist, { recursive: true, force: true }));
  const config: AppConfig = { isProduction: true, https: true, trustProxy: 1, clientDist: dist };
  const prodApp = createApp(config);

  it('hashed assets are immutable for a year; index.html is revalidated', async (t) => {
    t.mock.method(console, 'log', () => {});
    const asset = await request(prodApp).get('/assets/index-abc123.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
    for (const url of ['/', '/admin', '/admin/', '/index.html']) {
      const res = await request(prodApp).get(url);
      assert.equal(res.status, 200, url);
      assert.match(res.text, /<title>PW<\/title>/, url);
      assert.equal(res.headers['cache-control'], 'no-cache', url);
    }
    assert.equal((await request(prodApp).get('/logo-pink.png')).status, 200);
  });

  it('missing files and non-GET requests get 404, not index.html', async (t) => {
    t.mock.method(console, 'log', () => {});
    for (const url of ['/assets/index-old999.js', '/missing.png', '/admin/app.css']) {
      const res = await request(prodApp).get(url);
      assert.equal(res.status, 404, url);
      assert.ok(!res.text.includes('<title>PW'), url);
    }
    assert.equal((await request(prodApp).post('/admin')).status, 404);
    const api = await request(prodApp).get('/api/nope');
    assert.equal(api.status, 404);
    assert.deepEqual(api.body, { error: 'Not found' });
  });

  it('logs one JSON line per request (path without query string) and rate-limits /api but not health', async (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const res = await request(prodApp).get('/api/nope?email=a@b.c').set('X-Request-Id', 'req-42');
    assert.ok(res.headers['ratelimit-policy'], 'global API limiter headers');
    await new Promise((r) => setImmediate(r));
    const line = JSON.parse(String(log.mock.calls.at(-1)?.arguments[0]));
    assert.deepEqual({ ...line, ms: 0 }, { method: 'GET', path: '/api/nope', status: 404, ms: 0, id: 'req-42' });
    assert.equal((await request(prodApp).get('/api/health')).headers['ratelimit-policy'], undefined);
  });
});
