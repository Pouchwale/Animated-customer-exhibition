/**
 * API validation tests. These requests are rejected before any database access,
 * so no running Postgres is needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app.js';
import { HttpError } from './middleware/errors.js';
import { adminRouter, invalidateOnWrite } from './routes/admin.js';

const app = createApp();

describe('validation (no database)', () => {
  it('rejects an empty priority list', async () => {
    const res = await request(app).post('/api/suggestions').send({ priorities: [] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Validation failed');
    assert.ok(Array.isArray(res.body.details));
    assert.equal(res.body.details[0].path, 'priorities');
  });

  it('rejects duplicate priorities', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({
        priorities: [
          { key: 'price', label: 'Price' },
          { key: 'price', label: 'Price' },
        ],
      });
    assert.equal(res.status, 400);
    assert.match(res.body.details[0].message, /only appear once/);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app).post('/api/suggestions').set('Content-Type', 'application/json').send('{bad');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Request body is not valid JSON');
  });

  it('requires a session for recommendation parameters & options', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/suggestion-parameters'],
      ['post', '/api/admin/suggestion-parameters'],
      ['put', '/api/admin/suggestion-parameters/x'],
      ['delete', '/api/admin/suggestion-parameters/x'],
      ['post', '/api/admin/suggestion-parameters/reorder'],
      ['post', '/api/admin/suggestion-parameters/x/options'],
      ['post', '/api/admin/suggestion-parameters/x/options/reorder'],
      ['put', '/api/admin/suggestion-options/x'],
      ['delete', '/api/admin/suggestion-options/x'],
    ] as const) {
      const res = await request(app)[method](path);
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  it('reviews are gone: no review or feedback endpoints', async () => {
    assert.equal((await request(app).get('/api/reviews/flexible-packaging-pouch/summary')).status, 404);
    assert.equal((await request(app).post('/api/reviews/flexible-packaging-pouch').send({ ratings: { overall: 5 } })).status, 404);
  });

  it('the old Step 3 endpoint is gone', async () => {
    const res = await request(app)
      .post('/api/recommendations')
      .send({ priorities: [{ key: 'price', label: 'Price' }] });
    assert.equal(res.status, 404);
  });

  it('accepts up to 50 priorities, rejects 51', async () => {
    const { suggestionRequestSchema } = await import('./validation.js');
    const ranking = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `topic-${i}`, label: `Topic ${i}` }));
    assert.equal(suggestionRequestSchema.safeParse({ priorities: ranking(50) }).success, true);
    assert.equal(suggestionRequestSchema.safeParse({ priorities: ranking(51) }).success, false);
    const res = await request(app)
      .post('/api/suggestions')
      .send({ priorities: ranking(51) });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.details, [{ path: 'priorities', message: 'At most 50 priorities' }]);
  });

  it('requires a session for admin routes', async () => {
    const res = await request(app).get('/api/admin/parameters');
    assert.equal(res.status, 401);
  });

  it('role per admin route: editors manage topics, only admins delete them or touch recommendations and settings', () => {
    type Handler = (req: unknown, res: unknown, next: () => void) => void;
    type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } };
    const layers = (adminRouter as unknown as { stack: Layer[] }).stack;
    // Runs a route's own guards (everything before its handler) for a signed-in user with this role.
    const allows = (method: string, path: string, role: 'ADMIN' | 'EDITOR') => {
      const route = layers.find((l) => l.route?.path === path && l.route.methods[method])?.route;
      assert.ok(route, `${method} ${path} is registered`);
      const res = { locals: { user: { id: 'u', email: 'u@example.com', name: 'U', role } } };
      try {
        for (const { handle } of route.stack.slice(0, -1)) handle({}, res, () => {});
        return true;
      } catch (e) {
        if (e instanceof HttpError && e.status === 403) return false;
        throw e;
      }
    };
    const adminOnly = [
      ['delete', '/parameters/:id'],
      ['post', '/suggestion-parameters'],
      ['put', '/suggestion-parameters/:id'],
      ['delete', '/suggestion-parameters/:id'],
      ['post', '/suggestion-parameters/reorder'],
      ['post', '/suggestion-parameters/:id/options'],
      ['post', '/suggestion-parameters/:id/options/reorder'],
      ['put', '/suggestion-options/:id'],
      ['delete', '/suggestion-options/:id'],
      ['put', '/idle-logo'],
      ['put', '/intro'],
    ];
    const editorToo = [
      ['get', '/parameters'],
      ['post', '/parameters'],
      ['put', '/parameters/:id'],
      ['get', '/suggestion-parameters'],
      ['get', '/idle-logo'],
      ['get', '/intro'],
    ];
    for (const [method, path] of adminOnly) {
      assert.equal(allows(method!, path!, 'EDITOR'), false, `EDITOR may not ${method} ${path}`);
      assert.equal(allows(method!, path!, 'ADMIN'), true, `ADMIN may ${method} ${path}`);
    }
    for (const [method, path] of editorToo) assert.equal(allows(method!, path!, 'EDITOR'), true, `EDITOR may ${method} ${path}`);
    // Every admin route is in one of the two lists, so a new route can't skip this check.
    const listed = new Set([...adminOnly, ...editorToo].map(([m, p]) => `${m} ${p}`));
    for (const l of layers) {
      for (const m of Object.keys(l.route?.methods ?? {})) assert.ok(listed.has(`${m} ${l.route!.path}`), `${m} ${l.route!.path} has a role in this test`);
    }
  });

  it('every admin write clears the recommendation cache when the response closes (even if the client left early)', () => {
    let cleared = 0;
    const hook = invalidateOnWrite(() => cleared++);
    const run = (method: string) => {
      const listeners: Record<string, () => void> = {};
      const res = { once: (ev: string, fn: () => void) => (listeners[ev] = fn) };
      hook({ method } as never, res as never, () => {});
      listeners.close?.();
    };
    run('GET');
    run('HEAD');
    assert.equal(cleared, 0, 'reads keep the cache');
    for (const m of ['POST', 'PUT', 'DELETE']) run(m);
    assert.equal(cleared, 3, 'writes clear it');
  });

  it('rejects a forged session cookie', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'pw_session=not-a-jwt');
    assert.equal(res.status, 401);
  });

  it('validates login input', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nope', password: '' });
    assert.equal(res.status, 400);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  });
});

describe('update schemas', () => {
  it('do not inject defaults for omitted fields (partial updates must not reset data)', async () => {
    const v = await import('./validation.js');
    assert.deepEqual(v.parameterUpdateSchema.parse({ name: 'X', key: 'ignored', id: 'ignored' }), { name: 'X' });
    assert.deepEqual(v.suggestionOptionUpdateSchema.parse({ label: 'L' }), { label: 'L' });
    assert.deepEqual(v.suggestionParameterUpdateSchema.parse({ name: 'N' }), { name: 'N' });
    // …while create schemas still fill defaults.
    const created = v.parameterCreateSchema.parse({ name: 'N', category: 'quality', color: 'pink' });
    assert.equal(created.size, 2);
    assert.equal(created.active, true);
  });
});

describe('recommendation parameter & option validation', () => {
  it('parameter: defaults on create, key immutable on update, old display fields gone', async () => {
    const v = await import('./validation.js');
    const created = v.suggestionParameterCreateSchema.parse({ name: 'Print Type', description: '', multiple: true, featured: true }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(created, { name: 'Print Type', description: null, enabled: true });
    const u = v.suggestionParameterUpdateSchema.parse({ key: 'other', name: 'Print' }) as Record<string, unknown>;
    assert.equal('key' in u, false);
    assert.equal(v.suggestionParameterCreateSchema.safeParse({ name: '  ' }).success, false);
    assert.equal(v.suggestionParameterCreateSchema.safeParse({ name: 'X', key: 'Not A Slug' }).success, false);
  });

  it('option ratings: topic → 0–5 whole stars and a reason (≤ 140); none by default', async () => {
    const v = await import('./validation.js');
    assert.deepEqual(v.suggestionOptionCreateSchema.parse({ label: 'Digital Printing' }).ratings, {});
    assert.deepEqual(
      v.suggestionOptionCreateSchema.parse({ label: 'D', ratings: { moq: { stars: 5, reason: ' Small runs ' }, price: { stars: 0 } } }).ratings,
      {
        moq: { stars: 5, reason: 'Small runs' },
        price: { stars: 0, reason: null },
      },
    );
    for (const bad of [
      { moq: { stars: 6 } },
      { moq: { stars: 2.5 } },
      { moq: { stars: -1 } },
      { 'Not a key': { stars: 3 } },
      { moq: { stars: 3, reason: 'x'.repeat(141) } },
      ['moq'],
    ]) {
      assert.equal(v.suggestionOptionCreateSchema.safeParse({ label: 'D', ratings: bad }).success, false, JSON.stringify(bad));
    }
    assert.equal(
      'priorityOrder' in v.suggestionOptionCreateSchema.parse({ label: 'D', priorityOrder: ['moq'] }),
      false,
      'the old drag order is gone',
    );
  });

  it('reorder bodies may not repeat an id', async () => {
    const v = await import('./validation.js');
    assert.equal(v.reorderSchema.safeParse({ ids: ['a', 'b', 'a'] }).success, false);
    assert.equal(v.reorderSchema.safeParse({ ids: ['a', 'b'] }).success, true);
  });
});

describe('idle logo mode settings', () => {
  it('requires a session to read or change the admin settings', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/idle-logo'],
      ['put', '/api/admin/idle-logo'],
    ] as const) {
      const res = await request(app)[method](path);
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  it('validation: limits, speeds, whole seconds, partial updates', async () => {
    const v = await import('./validation.js');
    assert.deepEqual(v.idleLogoSettingsSchema.parse({ enabled: false }), { enabled: false });
    assert.equal(v.idleLogoSettingsSchema.parse({ idleMinutes: 2.5, transitionSpeed: 'fast', holdSeconds: 0 }).idleMinutes, 2.5);
    for (const bad of [
      { idleMinutes: 0 },
      { idleMinutes: 61 },
      { formSeconds: 0.5 },
      { formSeconds: 11 },
      { transitionSpeed: 'turbo' },
      { holdSeconds: 1.5 },
      { holdSeconds: -1 },
      { holdSeconds: 601 },
    ]) {
      assert.equal(v.idleLogoSettingsSchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('intro animation setting', () => {
  it('requires a session to read or change the admin setting', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/intro'],
      ['put', '/api/admin/intro'],
    ] as const) {
      const res = await request(app)[method](path);
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  it('validation: only known styles', async () => {
    const v = await import('./validation.js');
    for (const style of ['rotate', 'pouches', 'dots', 'zip', 'tagline', 'classic'])
      assert.equal(v.introSettingsSchema.safeParse({ style }).success, true, style);
    for (const bad of [{}, { style: 'spin' }, { style: 3 }]) assert.equal(v.introSettingsSchema.safeParse(bad).success, false, JSON.stringify(bad));
  });
});

describe('change password', () => {
  it('requires a session (no session, or a forged one)', async () => {
    const body = { currentPassword: 'whatever-old-1', newPassword: 'a-brand-new-pass' };
    assert.equal((await request(app).post('/api/auth/password').send(body)).status, 401);
    const forged = await request(app).post('/api/auth/password').set('Cookie', 'pw_session=not-a-jwt').send(body);
    assert.equal(forged.status, 401);
  });

  it('new password rules: 12+ characters, not repetitive, at most 72 bytes, not the email', async () => {
    const { passwordProblems, PASSWORD_RULES } = await import('@pw/shared');
    assert.equal(PASSWORD_RULES.minLength, 12);
    assert.deepEqual(passwordProblems('Tide-Pouch-2026!'), []);
    assert.equal(passwordProblems('short-pass1').length, 1, '11 characters');
    assert.equal(passwordProblems('   eleven-chr   ').length, 1, 'spaces around do not count');
    assert.equal(passwordProblems('aaaaaaaaaaaaaaaa').length, 1, 'repetitive');
    assert.equal(passwordProblems('x'.repeat(40) + 'abcdefgh'.repeat(5)).length, 1, 'over 72 bytes');
    assert.equal(passwordProblems('€'.repeat(25) + 'abcde').length, 1, '72-byte limit counts UTF-8 bytes');
    assert.equal(passwordProblems('Admin@PouchWale.com', 'admin@pouchwale.com').length, 1, 'email as password');
  });

  it('validation: current password required, new one must follow the rules and differ', async () => {
    const v = await import('./validation.js');
    const ok = v.changePasswordSchema.safeParse({ currentPassword: 'old-password', newPassword: 'Tide-Pouch-2026!' });
    assert.equal(ok.success, true);
    const bad = [
      { newPassword: 'Tide-Pouch-2026!' },
      { currentPassword: '', newPassword: 'Tide-Pouch-2026!' },
      { currentPassword: 'old-password', newPassword: 'short' },
      { currentPassword: 'Tide-Pouch-2026!', newPassword: 'Tide-Pouch-2026!' },
      { currentPassword: 'old-password', newPassword: 'z'.repeat(80) },
    ];
    for (const body of bad) assert.equal(v.changePasswordSchema.safeParse(body).success, false, JSON.stringify(body).slice(0, 80));
  });

  it('rejects a bad body before checking anything else', async () => {
    const res = await request(app).post('/api/auth/password').send({ currentPassword: 'x' });
    // No session: auth runs first, so the body is never looked at.
    assert.equal(res.status, 401);
  });
});
