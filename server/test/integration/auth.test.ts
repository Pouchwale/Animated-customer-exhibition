/**
 * Auth and roles against a real (throwaway) database, through HTTP.
 * Run: npm run test:integration -w server
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { sessionCookie, sessionSetCookie, startHarness, type Harness } from './harness.js';

let h: Harness;
/** The seeded admin's current password (changed by one test). */
let adminPassword: string;

before(async () => {
  h = await startHarness();
  adminPassword = h.db.admin.password;
});
after(async () => {
  await h?.close();
});

const me = (cookie: string) => h.api().get('/api/auth/me').set('Cookie', cookie);

describe('auth (real database)', () => {
  it('the seeded admin signs in; the session cookie is httpOnly, SameSite=Strict, Path=/api', async () => {
    const res = await h.api().post('/api/auth/login').send({ email: h.db.admin.email, password: adminPassword });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['email', 'id', 'name', 'role']);
    assert.equal(res.body.email, h.db.admin.email);
    assert.equal(res.body.role, 'ADMIN');
    const line = sessionSetCookie(res);
    assert.ok(line, 'Set-Cookie pw_session');
    assert.match(line, /HttpOnly/i);
    assert.match(line, /SameSite=Strict/i);
    assert.match(line, /Path=\/api(;|$)/);
    assert.doesNotMatch(line, /Secure/i, 'not Secure outside production over plain HTTP');

    const who = await me(sessionCookie(res)!);
    assert.equal(who.status, 200);
    assert.equal(who.body.id, res.body.id);
  });

  it('the email is case-insensitive', async () => {
    await h.login(h.db.admin.email.toUpperCase(), adminPassword);
  });

  it('a wrong password gets 401 with the same body as an unknown email, and no cookie', async () => {
    const wrong = await h.api().post('/api/auth/login').send({ email: h.db.admin.email, password: 'not-the-password-123' });
    const unknown = await h.api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'not-the-password-123' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, { error: 'Incorrect email or password' });
    assert.deepEqual(unknown.body, wrong.body);
    assert.equal(sessionCookie(wrong), undefined);
    assert.equal(sessionCookie(unknown), undefined);
  });

  it('logout answers 204 and clears the cookie', async (t) => {
    const cookie = await h.login(h.db.admin.email, adminPassword);
    const res = await h.api().post('/api/auth/logout').set('Cookie', cookie);
    assert.equal(res.status, 204);
    const line = sessionSetCookie(res);
    assert.ok(line, 'logout sends a Set-Cookie for pw_session');
    assert.match(line, /^pw_session=;/);
    assert.match(line, /Expires=Thu, 01 Jan 1970/);
    assert.match(line, /Path=\/api(;|$)/);
    // A browser now has no session.
    assert.equal((await me(sessionCookie(res)!)).status, 401);
    // Stateless JWT: a copy of the old token still works until it expires or the password changes. Recorded, not asserted.
    t.diagnostic(`replaying the logged-out token: /api/auth/me -> ${(await me(cookie)).status}`);
  });

  it('a token signed with another secret gets 401 and its cookie is cleared', async () => {
    const forged = jwt.sign({ sub: 'x', role: 'ADMIN', ver: 0 }, 'not-the-secret-not-the-secret-123', { algorithm: 'HS256' });
    const res = await me(`pw_session=${forged}`);
    assert.equal(res.status, 401);
    assert.match(sessionSetCookie(res) ?? '', /^pw_session=;/);
  });

  it('changing the password signs out every older session (tokenVersion) and the old password', async () => {
    const s1 = await h.login(h.db.admin.email, adminPassword);
    const s2 = await h.login(h.db.admin.email, adminPassword);
    const before = await h.prisma.adminUser.findUniqueOrThrow({ where: { email: h.db.admin.email } });

    const wrongCurrent = await h.api().post('/api/auth/password').set('Cookie', s2).send({ currentPassword: 'wrong-wrong-wrong', newPassword: 'A-brand-new-pass-42' });
    assert.equal(wrongCurrent.status, 400);
    assert.deepEqual(
      wrongCurrent.body.details.map((d: { path: string }) => d.path),
      ['currentPassword'],
    );
    const weak = await h.api().post('/api/auth/password').set('Cookie', s2).send({ currentPassword: adminPassword, newPassword: 'short' });
    assert.equal(weak.status, 400);
    assert.ok(weak.body.details.every((d: { path: string }) => d.path === 'newPassword'));

    const newPassword = `New-${adminPassword}-x`;
    const changed = await h.api().post('/api/auth/password').set('Cookie', s2).send({ currentPassword: adminPassword, newPassword });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const s3 = sessionCookie(changed);
    assert.ok(s3, 'the changing browser gets a fresh cookie');
    adminPassword = newPassword;

    const after = await h.prisma.adminUser.findUniqueOrThrow({ where: { email: h.db.admin.email } });
    assert.equal(after.tokenVersion, before.tokenVersion + 1);
    assert.notEqual(after.passwordHash, before.passwordHash);

    for (const old of [s1, s2]) {
      const res = await me(old);
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Your password was changed. Please sign in again');
      assert.match(sessionSetCookie(res) ?? '', /^pw_session=;/, 'the stale cookie is cleared');
    }
    assert.equal((await me(s3)).status, 200);

    const oldLogin = await h.api().post('/api/auth/login').send({ email: h.db.admin.email, password: h.db.admin.password });
    assert.equal(oldLogin.status, 401);
    await h.login(h.db.admin.email, newPassword);
  });

  it('a deleted account loses its session at once', async () => {
    const user = await h.createUser('EDITOR', 'gone@example.com', 'Gone-user-pass-1');
    const cookie = await h.login('gone@example.com', 'Gone-user-pass-1');
    assert.equal((await me(cookie)).status, 200);
    await h.prisma.adminUser.delete({ where: { id: user.id } });
    assert.equal((await me(cookie)).status, 401);
  });
});

describe('roles (real database)', () => {
  const editorEmail = 'editor@example.com';
  const editorPassword = 'Editor-pass-2026';
  let editor: string;
  let admin: string;

  before(async () => {
    await h.createUser('EDITOR', editorEmail, editorPassword);
    editor = await h.login(editorEmail, editorPassword);
    admin = await h.login(h.db.admin.email, adminPassword);
  });

  const snapshot = async () => ({
    topics: await h.prisma.parameter.findMany({ orderBy: { key: 'asc' } }),
    params: await h.prisma.suggestionParameter.findMany({ orderBy: { key: 'asc' } }),
    options: await h.prisma.suggestionOption.findMany({ orderBy: { id: 'asc' } }),
    ratings: await h.prisma.suggestionRating.count(),
    intro: await h.prisma.introSettings.findMany(),
    idle: await h.prisma.idleLogoSettings.findMany(),
  });

  it('an EDITOR gets 403 on every ADMIN-only write (including deleting a topic) and nothing changes', async () => {
    const topic = await h.prisma.parameter.findUniqueOrThrow({ where: { key: 'price' } });
    const param = await h.prisma.suggestionParameter.findFirstOrThrow({ include: { options: true }, orderBy: { sortOrder: 'asc' } });
    const params = await h.prisma.suggestionParameter.findMany({ select: { id: true } });
    const option = param.options[0]!;
    const before = await snapshot();

    const calls: [method: 'post' | 'put' | 'delete', path: string, body?: object][] = [
      ['delete', `/api/admin/parameters/${topic.id}`],
      ['post', '/api/admin/suggestion-parameters', { name: 'Editor Param' }],
      ['put', `/api/admin/suggestion-parameters/${param.id}`, { name: 'Renamed' }],
      ['delete', `/api/admin/suggestion-parameters/${param.id}`],
      ['post', '/api/admin/suggestion-parameters/reorder', { ids: params.map((p) => p.id).reverse() }],
      ['post', `/api/admin/suggestion-parameters/${param.id}/options`, { label: 'Editor Option' }],
      ['post', `/api/admin/suggestion-parameters/${param.id}/options/reorder`, { ids: param.options.map((o) => o.id).reverse() }],
      ['put', `/api/admin/suggestion-options/${option.id}`, { ratings: { price: { stars: 1, reason: null } } }],
      ['delete', `/api/admin/suggestion-options/${option.id}`],
      ['put', '/api/admin/idle-logo', { enabled: false }],
      ['put', '/api/admin/intro', { style: 'dots' }],
    ];
    for (const [method, path, body] of calls) {
      const res = await h.api()[method](path).set('Cookie', editor).send(body ?? {});
      assert.equal(res.status, 403, `${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: 'Your role does not allow this action' });
    }
    assert.deepEqual(await snapshot(), before, 'no ADMIN-only write took effect');

    // The same topic delete works for an ADMIN (checked on a throwaway topic so other tests keep "price").
    const spare = await h.prisma.parameter.create({ data: { key: 'spare', name: 'Spare', category: 'design', color: 'blue' } });
    assert.equal((await h.api().delete(`/api/admin/parameters/${spare.id}`).set('Cookie', admin)).status, 204);
  });

  it('an EDITOR can create, edit and hide topics, and read everything else', async () => {
    const created = await h.api().post('/api/admin/parameters').set('Cookie', editor).send({ name: 'Eco Friendly', category: 'material', color: 'blue' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.key, 'eco-friendly');
    assert.equal(created.body.active, true);
    assert.equal(created.body.size, 2);

    const id = created.body.id as string;
    const edited = await h.api().put(`/api/admin/parameters/${id}`).set('Cookie', editor).send({ name: 'Eco-friendly', description: 'Recyclable films', key: 'hacked' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.name, 'Eco-friendly');
    assert.equal(edited.body.key, 'eco-friendly', 'the key cannot change');

    const pub = async () => ((await h.api().get('/api/parameters')).body as { key: string }[]).map((p) => p.key);
    assert.ok((await pub()).includes('eco-friendly'));
    const hidden = await h.api().put(`/api/admin/parameters/${id}`).set('Cookie', editor).send({ active: false });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.active, false);
    assert.ok(!(await pub()).includes('eco-friendly'), 'hidden from customers');

    for (const path of ['/api/admin/parameters', '/api/admin/suggestion-parameters', '/api/admin/intro', '/api/admin/idle-logo']) {
      assert.equal((await h.api().get(path).set('Cookie', editor)).status, 200, path);
    }
    // Still ADMIN-only, even for a topic the editor made.
    assert.equal((await h.api().delete(`/api/admin/parameters/${id}`).set('Cookie', editor)).status, 403);
    assert.ok(await h.prisma.parameter.findUnique({ where: { id } }));
  });

  it('a role change applies to an existing session at once', async () => {
    const user = await h.createUser('ADMIN', 'demoted@example.com', 'Demoted-pass-2026');
    const cookie = await h.login('demoted@example.com', 'Demoted-pass-2026');
    const ok = await h.api().put('/api/admin/intro').set('Cookie', cookie).send({ style: 'zip' });
    assert.equal(ok.status, 200);
    await h.prisma.adminUser.update({ where: { id: user.id }, data: { role: 'EDITOR' } });
    const denied = await h.api().put('/api/admin/intro').set('Cookie', cookie).send({ style: 'dots' });
    assert.equal(denied.status, 403);
  });
});
