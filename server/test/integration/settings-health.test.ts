/**
 * Settings rows, health/readiness and request validation edges against a real (throwaway) database, through HTTP.
 * The last test stops the database to check /api/ready answers 503.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let cookie: string;

before(async () => {
  h = await startHarness();
  cookie = await h.login(h.db.admin.email, h.db.admin.password);
});
after(async () => {
  await h?.close();
});

const INTRO_DEFAULT = { style: 'rotate' };
const IDLE_DEFAULTS = { enabled: true, idleMinutes: 1, formSeconds: 3, transitionSpeed: 'normal', holdSeconds: 20 };
const rowCounts = async () => ({ intro: await h.prisma.introSettings.count(), idle: await h.prisma.idleLogoSettings.count() });
const deleteRows = async () => {
  await h.prisma.introSettings.deleteMany();
  await h.prisma.idleLogoSettings.deleteMany();
};

describe('settings', () => {
  it('the seed created both rows', async () => {
    assert.deepEqual(await rowCounts(), { intro: 1, idle: 1 });
  });

  it('with the rows deleted, the GETs return the defaults and create no rows', async () => {
    await deleteRows();
    for (let i = 0; i < 2; i++) {
      const intro = await h.api().get('/api/intro');
      assert.equal(intro.status, 200);
      assert.deepEqual(intro.body, INTRO_DEFAULT);
      const idle = await h.api().get('/api/idle-logo');
      assert.equal(idle.status, 200);
      assert.deepEqual(idle.body, IDLE_DEFAULTS);
      // The admin GETs read the same way.
      assert.deepEqual((await h.api().get('/api/admin/intro').set('Cookie', cookie)).body, INTRO_DEFAULT);
      assert.deepEqual((await h.api().get('/api/admin/idle-logo').set('Cookie', cookie)).body, IDLE_DEFAULTS);
    }
    assert.deepEqual(await rowCounts(), { intro: 0, idle: 0 }, 'reads never write');
  });

  it('an ADMIN PUT creates the missing row, then updates the same row', async () => {
    await deleteRows();
    const first = await h.api().put('/api/admin/intro').set('Cookie', cookie).send({ style: 'dots' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { style: 'dots' });
    assert.equal((await rowCounts()).intro, 1);
    const second = await h.api().put('/api/admin/intro').set('Cookie', cookie).send({ style: 'zip' });
    assert.deepEqual(second.body, { style: 'zip' });
    assert.equal((await rowCounts()).intro, 1);
    assert.deepEqual((await h.api().get('/api/intro')).body, { style: 'zip' });

    // Idle logo: partial PUTs; omitted fields keep their value (the schema defaults on create).
    const idle1 = await h.api().put('/api/admin/idle-logo').set('Cookie', cookie).send({ holdSeconds: 0 });
    assert.equal(idle1.status, 200);
    assert.deepEqual(idle1.body, { ...IDLE_DEFAULTS, holdSeconds: 0 });
    const idle2 = await h.api().put('/api/admin/idle-logo').set('Cookie', cookie).send({ enabled: false, idleMinutes: 2.5 });
    assert.deepEqual(idle2.body, { ...IDLE_DEFAULTS, holdSeconds: 0, enabled: false, idleMinutes: 2.5 });
    assert.equal((await rowCounts()).idle, 1);
    assert.deepEqual((await h.api().get('/api/idle-logo')).body, idle2.body);
  });

  it('invalid settings get 400 and change nothing', async () => {
    const before = { intro: (await h.api().get('/api/intro')).body, idle: (await h.api().get('/api/idle-logo')).body };
    for (const body of [{ style: 'nope' }, {}]) {
      assert.equal((await h.api().put('/api/admin/intro').set('Cookie', cookie).send(body)).status, 400, JSON.stringify(body));
    }
    for (const body of [{ idleMinutes: 0 }, { idleMinutes: 61 }, { formSeconds: 11 }, { holdSeconds: 1.5 }, { holdSeconds: 601 }, { transitionSpeed: 'warp' }, { enabled: 'yes' }]) {
      assert.equal((await h.api().put('/api/admin/idle-logo').set('Cookie', cookie).send(body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual({ intro: (await h.api().get('/api/intro')).body, idle: (await h.api().get('/api/idle-logo')).body }, before);
  });

  it('concurrent first saves to a missing row all succeed and leave one row', async () => {
    await deleteRows();
    const styles = ['dots', 'zip', 'pouches', 'classic', 'rotate', 'dots', 'zip', 'pouches'];
    const intro = await Promise.all(styles.map((style) => h.api().put('/api/admin/intro').set('Cookie', cookie).send({ style })));
    const idle = await Promise.all([0, 10, 20, 30, 40, 50, 60, 70].map((holdSeconds) => h.api().put('/api/admin/idle-logo').set('Cookie', cookie).send({ holdSeconds })));
    assert.deepEqual(
      [...intro, ...idle].map((r) => r.status),
      Array(16).fill(200),
      JSON.stringify([...intro, ...idle].filter((r) => r.status !== 200).map((r) => r.body)),
    );
    assert.deepEqual(await rowCounts(), { intro: 1, idle: 1 });
  });

  it('a stored value the app no longer knows reads as the default', async () => {
    await h.prisma.introSettings.update({ where: { id: 1 }, data: { style: 'retired-style' } });
    await h.prisma.idleLogoSettings.update({ where: { id: 1 }, data: { transitionSpeed: 'warp' } });
    assert.deepEqual((await h.api().get('/api/intro')).body, INTRO_DEFAULT);
    assert.equal((await h.api().get('/api/idle-logo')).body.transitionSpeed, 'normal');
  });
});

describe('validation edges', () => {
  const ranking = (n: number, real: string[]) =>
    Array.from({ length: n }, (_, i) => (i < real.length ? { key: real[i]!, label: real[i]! } : { key: `custom:extra-${i}`, label: `Extra ${i}` }));

  it('50 priorities are accepted; 51 are rejected', async () => {
    const topics = ((await h.api().get('/api/parameters')).body as { key: string }[]).map((p) => p.key);
    assert.ok(topics.length >= 7);
    const ok = await h.api().post('/api/suggestions').send({ priorities: ranking(50, topics) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.breakdown.length, 50);
    assert.deepEqual(ok.body.breakdown[49], { rank: 50, key: 'custom:extra-49', label: 'Extra 49', level: 'LOW', weight: 10 });
    assert.ok(ok.body.recommendations.length >= 2, 'the real topics still count');

    const tooMany = await h.api().post('/api/suggestions').send({ priorities: ranking(51, topics) });
    assert.equal(tooMany.status, 400);
    assert.deepEqual(tooMany.body.details, [{ path: 'priorities', message: 'At most 50 priorities' }]);
  });

  it('malformed JSON gets 400 on public, auth and admin routes', async () => {
    for (const [path, auth] of [
      ['/api/suggestions', false],
      ['/api/auth/login', false],
      ['/api/admin/parameters', true],
    ] as const) {
      let req = h.api().post(path).set('Content-Type', 'application/json');
      if (auth) req = req.set('Cookie', cookie);
      const res = await req.send('{"priorities": [');
      assert.equal(res.status, 400, path);
      assert.deepEqual(res.body, { error: 'Request body is not valid JSON' }, path);
    }
  });

  it('a body over 100 kB gets 413; one just under is parsed (and then validated)', async () => {
    const body = (bytes: number) => {
      const shell = '{"priorities":[{"key":"price","label":""}]}';
      return shell.replace('"label":""', `"label":"${'x'.repeat(bytes - shell.length)}"`);
    };
    const big = body(100 * 1024 + 1);
    assert.equal(Buffer.byteLength(big), 100 * 1024 + 1);
    for (const path of ['/api/suggestions', '/api/auth/login', '/api/admin/parameters']) {
      const res = await h.api().post(path).set('Content-Type', 'application/json').set('Cookie', cookie).send(big);
      assert.equal(res.status, 413, path);
      assert.deepEqual(res.body, { error: 'Request body is too large' });
    }
    const under = await h.api().post('/api/suggestions').set('Content-Type', 'application/json').send(body(100 * 1024));
    assert.equal(under.status, 400, 'parsed, then the 40-character label limit applies');
    assert.equal(under.body.error, 'Validation failed');
  });

  it('a non-JSON body gets a 400 validation error, not a 500', async () => {
    const res = await h.api().post('/api/suggestions').set('Content-Type', 'text/plain').send('price,moq');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Validation failed');
  });

  it('Unicode (₹, Hindi) survives the round trip through the database', async () => {
    const name = '₹ कीमत';
    const created = await h.api()
      .post('/api/admin/parameters')
      .set('Cookie', cookie)
      .send({ key: 'rupee-price', name, description: 'सबसे कम कीमत ₹', category: 'commercial', color: 'yellow' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const pub = (await h.api().get('/api/parameters')).body as { key: string; name: string; description: string }[];
    const row = pub.find((p) => p.key === 'rupee-price');
    assert.equal(row?.name, name);
    assert.equal(row?.description, 'सबसे कम कीमत ₹');
  });
});

describe('health', () => {
  it('/api/health answers 200 {ok: true}', async () => {
    const res = await h.api().get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  it('/api/ready answers 200 {ok: true} with the database up', async () => {
    const res = await h.api().get('/api/ready');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  // Last: stops this file's database.
  it('/api/ready answers 503 once the database is stopped; /api/health stays 200; errors leak nothing', { timeout: 60_000 }, async () => {
    await h.db.stop();
    const t0 = Date.now();
    const ready = await h.api().get('/api/ready');
    const ms = Date.now() - t0;
    assert.equal(ready.status, 503);
    assert.deepEqual(ready.body, { ok: false });
    assert.ok(ms < 3000, `answered in ${ms} ms (2 s budget)`);
    assert.equal((await h.api().get('/api/health')).status, 200);

    const data = await h.api().get('/api/parameters');
    assert.equal(data.status, 500);
    assert.deepEqual(data.body, { error: 'Something went wrong. Please try again.' });
    assert.doesNotMatch(JSON.stringify(data.body) + JSON.stringify(data.headers), new RegExp(`${h.db.port}|127\\.0\\.0\\.1|postgres`));
  });
});
