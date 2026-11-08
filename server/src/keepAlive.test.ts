import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { keepAliveTarget, parseEnv } from './config/env.js';
import { startKeepAlive } from './keepAlive.js';

const BASE = { DATABASE_URL: 'postgresql://app:pw@db:5432/pouchwale', JWT_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8' };

describe('keep-alive ping (Render free plan)', () => {
  it('is on by itself on Render, off elsewhere, and can be overridden or turned off', () => {
    assert.equal(keepAliveTarget(undefined, undefined), undefined, 'not on Render: off');
    assert.equal(keepAliveTarget(undefined, 'https://pouchwale.onrender.com'), 'https://pouchwale.onrender.com/api/health');
    assert.equal(keepAliveTarget(undefined, 'https://pouchwale.onrender.com/some/path'), 'https://pouchwale.onrender.com/api/health');
    assert.equal(keepAliveTarget('false', 'https://pouchwale.onrender.com'), undefined, 'KEEP_ALIVE_URL=false turns it off');
    assert.equal(keepAliveTarget('https://configurator.pouchwale.com', 'https://x.onrender.com'), 'https://configurator.pouchwale.com/api/health');
    assert.equal(keepAliveTarget('ftp://nope', undefined), undefined);
    assert.equal(keepAliveTarget('not a url', undefined), undefined);
  });

  it('config: wired through parseEnv, bad values rejected', () => {
    const on = parseEnv({ ...BASE, NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://pw.onrender.com' }, '/x');
    assert.ok(on.ok);
    assert.equal(on.env.keepAliveUrl, 'https://pw.onrender.com/api/health');
    assert.equal(on.env.KEEP_ALIVE_MINUTES, 10);
    const off = parseEnv({ ...BASE }, '/x');
    assert.ok(off.ok);
    assert.equal(off.env.keepAliveUrl, null, 'local development: no ping');
    const bad = parseEnv({ ...BASE, KEEP_ALIVE_URL: 'not a url' }, '/x');
    assert.equal(bad.ok, false);
    for (const m of ['0', '15', 'x']) assert.equal(parseEnv({ ...BASE, KEEP_ALIVE_MINUTES: m }, '/x').ok, false, `KEEP_ALIVE_MINUTES=${m}`);
  });

  it('pings the health URL, logs a failure once per outage and the recovery', async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    let status = 200;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${(init?.headers as Record<string, string>)['user-agent']}`);
      if (status === 0) throw new Error('fetch failed');
      return new Response('{"ok":true}', { status });
    }) as unknown as typeof fetch;
    const log = { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };
    const ka = startKeepAlive({ url: 'https://pw.onrender.com/api/health', everyMs: 60_000, fetchImpl, log });
    try {
      await ka.ping();
      status = 0;
      await ka.ping();
      await ka.ping();
      status = 503;
      await ka.ping();
      status = 200;
      await ka.ping();
    } finally {
      ka.stop();
    }
    assert.equal(calls.length, 5);
    assert.equal(calls[0], 'https://pw.onrender.com/api/health PouchWale keep-alive');
    assert.deepEqual(logs, [
      '[keep-alive] pinging https://pw.onrender.com/api/health every 1 min',
      '[keep-alive] ping failed (fetch failed); will keep trying',
      '[keep-alive] reachable again',
    ]);
  });
});
