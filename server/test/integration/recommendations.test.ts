/**
 * Recommendation data, topic cascade, topic visibility and the suggestion cache, against a real (throwaway)
 * database through HTTP. Each block creates its own topics and parameters, so blocks don't depend on each other.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SuggestionResult } from '@pw/shared';
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

// ---- helpers -------------------------------------------------------------------------------------------

const get = (path: string) => h.api().get(path).set('Cookie', cookie);
const post = (path: string, body: object) => h.api().post(path).set('Cookie', cookie).send(body);
const put = (path: string, body: object) => h.api().put(path).set('Cookie', cookie).send(body);
const del = (path: string) => h.api().delete(path).set('Cookie', cookie);

async function suggest(keys: string[]): Promise<SuggestionResult> {
  const res = await h.api()
    .post('/api/suggestions')
    .send({ priorities: keys.map((key) => ({ key, label: key.slice(0, 40) })) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}
const recFor = (r: SuggestionResult, paramKey: string) => r.recommendations.find((x) => x.key === paramKey);

/** A topic through the API (ADMIN). */
async function topic(key: string, active = true): Promise<{ id: string; key: string }> {
  const res = await post('/api/admin/parameters', { key, name: key.slice(0, 40), category: 'design', color: 'pink', active });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

type Stars = Record<string, number>;
const ratingsBody = (stars: Stars) => Object.fromEntries(Object.entries(stars).map(([k, s]) => [k, { stars: s, reason: `${k} ${s}` }]));

/** A recommendation parameter with options, through the API. Options come back in creation order. */
async function param(name: string, options: { label: string; stars: Stars }[]) {
  const p = await post('/api/admin/suggestion-parameters', { name });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const created: { id: string; label: string }[] = [];
  for (const o of options) {
    const res = await post(`/api/admin/suggestion-parameters/${p.body.id}/options`, { label: o.label, ratings: ratingsBody(o.stars) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created.push(res.body);
  }
  return { id: p.body.id as string, key: p.body.key as string, options: created };
}

const dbRatings = async (optionId: string) =>
  (await h.prisma.suggestionRating.findMany({ where: { optionId }, orderBy: { topicKey: 'asc' } })).map((r) => ({
    topicKey: r.topicKey,
    stars: r.stars,
    reason: r.reason,
  }));

// ---- recommendation data ---------------------------------------------------------------------------------

describe('recommendation data', () => {
  let zipper: Awaited<ReturnType<typeof param>>;

  it('creates a parameter with options and 1–5 star ratings (0 = not stored, empty reason = null)', async () => {
    const p = await post('/api/admin/suggestion-parameters', { name: 'Zipper Type', description: '' });
    assert.equal(p.status, 201);
    assert.equal(p.body.key, 'zipper-type');
    assert.equal(p.body.description, null);
    assert.equal(p.body.enabled, true);
    assert.equal(p.body.sortOrder, 3, 'added after the two seeded parameters');
    assert.deepEqual(p.body.options, []);

    const a = await post(`/api/admin/suggestion-parameters/${p.body.id}/options`, {
      label: '  Press-to-close  ',
      description: 'Reclosable',
      ratings: { price: { stars: 4, reason: 'Cheap' }, moq: { stars: 0, reason: 'ignored' }, 'print-quality': { stars: 2, reason: '' } },
    });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.label, 'Press-to-close', 'trimmed');
    assert.equal(a.body.sortOrder, 1);
    assert.deepEqual(a.body.ratings, [
      { topicKey: 'price', stars: 4, reason: 'Cheap' },
      { topicKey: 'print-quality', stars: 2, reason: null },
    ]);
    const b = await post(`/api/admin/suggestion-parameters/${p.body.id}/options`, {
      label: 'Slider',
      ratings: { price: { stars: 2, reason: null }, 'print-quality': { stars: 5, reason: 'Premium feel' } },
    });
    assert.equal(b.status, 201);
    assert.equal(b.body.sortOrder, 2);
    zipper = { id: p.body.id, key: p.body.key, options: [a.body, b.body] };

    assert.deepEqual(await dbRatings(a.body.id), [
      { topicKey: 'price', stars: 4, reason: 'Cheap' },
      { topicKey: 'print-quality', stars: 2, reason: null },
    ]);
    const list = (await get('/api/admin/suggestion-parameters')).body as { key: string; options: { label: string }[] }[];
    assert.deepEqual(
      list.find((x) => x.key === 'zipper-type')?.options.map((o) => o.label),
      ['Press-to-close', 'Slider'],
    );
    // Live for customers at once.
    assert.equal(recFor(await suggest(['price']), 'zipper-type')?.recommended.label, 'Press-to-close');
    assert.equal(recFor(await suggest(['print-quality']), 'zipper-type')?.recommended.label, 'Slider');
  });

  it('the seeded data gives the documented example: Price, MOQ, Print Quality -> Flexo Printing at 3.9 stars', async () => {
    const r = recFor(await suggest(['price', 'moq', 'print-quality']), 'print-type');
    assert.equal(r?.recommended.label, 'Flexo Printing');
    assert.equal(r?.recommended.stars, 3.9);
    assert.deepEqual(
      r?.others.map((o) => [o.label, o.stars]),
      [
        ['Hybrid Printing', 3.8],
        ['Gravure Printing', 3.7],
        // Same fit (840/240): the tie goes to more stars on the #1 topic, Price (Offset 3, Digital 2).
        ['Offset Printing', 3.5],
        ['Digital Printing', 3.5],
      ],
    );
  });

  it('PUT ratings replaces all of the option’s ratings; a PUT without ratings keeps them', async () => {
    const a = zipper.options[0]!;
    const res = await put(`/api/admin/suggestion-options/${a.id}`, { ratings: { 'special-colour': { stars: 3, reason: 'Ok' } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.ratings, [{ topicKey: 'special-colour', stars: 3, reason: 'Ok' }]);
    assert.deepEqual(await dbRatings(a.id), [{ topicKey: 'special-colour', stars: 3, reason: 'Ok' }]);

    const renamed = await put(`/api/admin/suggestion-options/${a.id}`, { description: 'Still reclosable' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await dbRatings(a.id), [{ topicKey: 'special-colour', stars: 3, reason: 'Ok' }], 'untouched without ratings');

    const cleared = await put(`/api/admin/suggestion-options/${a.id}`, { ratings: {} });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await dbRatings(a.id), [], 'an empty map clears them');

    const restored = await put(`/api/admin/suggestion-options/${a.id}`, {
      ratings: { price: { stars: 4, reason: 'Cheap' }, 'print-quality': { stars: 2, reason: null } },
    });
    assert.equal(restored.status, 200);
  });

  it('the ratings replace is one transaction: when an insert fails, the old ratings and fields stay', async () => {
    const a = zipper.options[0]!;
    const before = await dbRatings(a.id);
    const beforeLabel = (await h.prisma.suggestionOption.findUniqueOrThrow({ where: { id: a.id } })).label;
    // Make the database refuse one specific reason, so deleteMany succeeds and createMany then fails.
    await h.db.sql(`ALTER TABLE "SuggestionRating" ADD CONSTRAINT itest_refuse CHECK (reason IS DISTINCT FROM 'itest-refuse')`);
    try {
      const res = await put(`/api/admin/suggestion-options/${a.id}`, {
        label: 'Should Not Stick',
        ratings: { moq: { stars: 5, reason: 'fine' }, price: { stars: 1, reason: 'itest-refuse' } },
      });
      assert.ok(res.status >= 400, `refused write answered ${res.status}`);
      assert.doesNotMatch(JSON.stringify(res.body), /itest_refuse|constraint|SuggestionRating/i, 'no database detail leaks');
    } finally {
      await h.db.sql('ALTER TABLE "SuggestionRating" DROP CONSTRAINT itest_refuse');
    }
    assert.deepEqual(await dbRatings(a.id), before, 'ratings rolled back');
    assert.equal((await h.prisma.suggestionOption.findUniqueOrThrow({ where: { id: a.id } })).label, beforeLabel, 'label rolled back');
  });

  // KNOWN BUG (reported): a ratings-only PUT runs prisma.suggestionOption.update with empty data, which takes no row lock,
  // so two saves interleave (delete, delete, insert, insert) and one fails with 409 on (optionId, topicKey).
  it('concurrent rating saves of the same option all succeed (last write wins)', async () => {
    const a = zipper.options[0]!;
    const failures: string[] = [];
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all(
        [1, 2, 3, 4].map((stars) => put(`/api/admin/suggestion-options/${a.id}`, { ratings: { price: { stars, reason: null }, moq: { stars, reason: null } } })),
      );
      for (const r of results) if (r.status !== 200) failures.push(`${r.status} ${JSON.stringify(r.body)}`);
      const rows = await dbRatings(a.id);
      assert.equal(rows.length, 2, 'never a partial set');
      assert.equal(rows[0]!.stars, rows[1]!.stars, 'both ratings from the same save');
    }
    assert.deepEqual(failures, [], `${failures.length}/20 concurrent saves failed`);
  });

  it('a rating for an unknown topic gets 400 and changes nothing', async () => {
    const before = await h.prisma.suggestionOption.count();
    const created = await post(`/api/admin/suggestion-parameters/${zipper.id}/options`, { label: 'Ghost', ratings: { nope: { stars: 3, reason: null } } });
    assert.equal(created.status, 400);
    assert.equal(created.body.error, 'Unknown priority topic: nope');
    assert.deepEqual(created.body.details, [{ path: 'ratings.nope', message: 'Unknown topic' }]);
    assert.equal(await h.prisma.suggestionOption.count(), before, 'no option created');

    const b = zipper.options[1]!;
    const ratingsBefore = await dbRatings(b.id);
    const updated = await put(`/api/admin/suggestion-options/${b.id}`, {
      ratings: { price: { stars: 5, reason: null }, nope: { stars: 2, reason: null }, 'also-nope': { stars: 1, reason: null } },
    });
    assert.equal(updated.status, 400);
    assert.deepEqual(
      updated.body.details.map((d: { path: string }) => d.path),
      ['ratings.nope', 'ratings.also-nope'],
    );
    assert.deepEqual(await dbRatings(b.id), ratingsBefore);
  });

  it('a duplicate option label gets 409 with details as a {path, message} list', async () => {
    const isDetailList = (details: unknown) =>
      Array.isArray(details) &&
      details.length > 0 &&
      details.every((d) => typeof d === 'object' && d !== null && typeof d.path === 'string' && typeof d.message === 'string');

    const dup = await post(`/api/admin/suggestion-parameters/${zipper.id}/options`, { label: ' Slider ' });
    assert.equal(dup.status, 409, JSON.stringify(dup.body));
    assert.equal(dup.body.error, 'A record with this value already exists');
    assert.ok(isDetailList(dup.body.details), `details: ${JSON.stringify(dup.body.details)}`);
    assert.ok(
      dup.body.details.some((d: { path: string }) => d.path === 'label'),
      `a detail points at the label: ${JSON.stringify(dup.body.details)}`,
    );

    const rename = await put(`/api/admin/suggestion-options/${zipper.options[1]!.id}`, { label: 'Press-to-close' });
    assert.equal(rename.status, 409);
    assert.ok(isDetailList(rename.body.details), `details: ${JSON.stringify(rename.body.details)}`);

    // Unique per parameter only.
    const other = await h.prisma.suggestionParameter.findUniqueOrThrow({ where: { key: 'material-type' } });
    assert.equal((await post(`/api/admin/suggestion-parameters/${other.id}/options`, { label: 'Slider' })).status, 201);

    // Duplicate keys: parameter and topic.
    const dupParam = await post('/api/admin/suggestion-parameters', { name: 'Zipper Type' });
    assert.equal(dupParam.status, 409);
    assert.ok(isDetailList(dupParam.body.details), `details: ${JSON.stringify(dupParam.body.details)}`);
    const dupTopic = await post('/api/admin/parameters', { name: 'Price', category: 'commercial', color: 'blue' });
    assert.equal(dupTopic.status, 409);
    assert.ok(isDetailList(dupTopic.body.details), `details: ${JSON.stringify(dupTopic.body.details)}`);
  });

  it('a reorder with a missing, unknown or repeated id gets 400; a valid one persists', async () => {
    const c = await post(`/api/admin/suggestion-parameters/${zipper.id}/options`, { label: 'Spout' });
    assert.equal(c.status, 201);
    const [a, b] = zipper.options.map((o) => o.id) as [string, string];
    const cId = c.body.id as string;
    const path = `/api/admin/suggestion-parameters/${zipper.id}/options/reorder`;
    const foreign = (await h.prisma.suggestionOption.findFirstOrThrow({ where: { parameterId: { not: zipper.id } } })).id;

    const missing = await post(path, { ids: [a, b] });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body.details, [{ path: 'ids', message: `Missing option id: ${cId}` }]);

    const unknown = await post(path, { ids: [a, b, cId, 'nope'] });
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.body.details, [{ path: 'ids.3', message: 'Unknown option id: nope' }]);

    const swapped = await post(path, { ids: [a, b, foreign] });
    assert.equal(swapped.status, 400, 'an option of another parameter');
    assert.equal((await post(path, { ids: [a, a, b] })).status, 400, 'repeated id');
    assert.equal((await post('/api/admin/suggestion-parameters/nope/options/reorder', { ids: [] })).status, 404);

    const before = await h.prisma.suggestionOption.findMany({ where: { parameterId: zipper.id }, orderBy: { sortOrder: 'asc' } });
    assert.deepEqual(
      before.map((o) => o.id),
      [a, b, cId],
      'refused reorders changed nothing',
    );

    const ok = await post(path, { ids: [cId, a, b] });
    assert.equal(ok.status, 200);
    assert.deepEqual(
      ok.body.options.map((o: { id: string; sortOrder: number }) => [o.id, o.sortOrder]),
      [
        [cId, 1],
        [a, 2],
        [b, 3],
      ],
    );
    const stored = await h.prisma.suggestionOption.findMany({ where: { parameterId: zipper.id }, orderBy: { sortOrder: 'asc' } });
    assert.deepEqual(
      stored.map((o) => [o.id, o.sortOrder]),
      [
        [cId, 1],
        [a, 2],
        [b, 3],
      ],
    );

    // Concurrent reorders (rows locked in id order): all succeed, and the result is one of the requested orders.
    const orders = [
      [a, b, cId],
      [b, cId, a],
      [cId, b, a],
      [a, cId, b],
    ];
    const results = await Promise.all(orders.map((ids) => post(path, { ids })));
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 200, 200],
    );
    const final = (await h.prisma.suggestionOption.findMany({ where: { parameterId: zipper.id }, orderBy: { sortOrder: 'asc' } })).map((o) => o.id);
    assert.ok(
      orders.some((o) => o.join() === final.join()),
      `final order ${final.join()} is one of the requests`,
    );
    assert.equal((await post(path, { ids: [cId, a, b] })).status, 200);

    // Parameters: the same rules, and the customer's recommendations follow the admin order.
    const params = (await h.prisma.suggestionParameter.findMany({ orderBy: { sortOrder: 'asc' } })).map((p) => p.id);
    assert.equal((await post('/api/admin/suggestion-parameters/reorder', { ids: params.slice(1) })).status, 400);
    assert.equal((await post('/api/admin/suggestion-parameters/reorder', { ids: [...params, 'nope'] })).status, 400);
    const reversed = [...params].reverse();
    const pOk = await post('/api/admin/suggestion-parameters/reorder', { ids: reversed });
    assert.equal(pOk.status, 200);
    assert.deepEqual(
      pOk.body.map((p: { id: string }) => p.id),
      reversed,
    );
    const keysInOrder = (await h.prisma.suggestionParameter.findMany({ orderBy: { sortOrder: 'asc' } })).map((p) => p.key);
    const shown = (await suggest(['price', 'print-quality'])).recommendations.map((r) => r.key);
    assert.deepEqual(
      shown,
      keysInOrder.filter((k) => shown.includes(k)),
      'recommendations in the new admin order',
    );
    assert.equal(shown[0], 'zipper-type');
  });
});

// ---- cascade --------------------------------------------------------------------------------------------

describe('cascade', () => {
  it('an ADMIN deleting a topic removes its ratings and nothing else', async () => {
    const t = await h.prisma.parameter.findUniqueOrThrow({ where: { key: 'special-colour' } });
    const onTopic = await h.prisma.suggestionRating.count({ where: { topicKey: 'special-colour' } });
    const total = await h.prisma.suggestionRating.count();
    const options = await h.prisma.suggestionOption.count();
    assert.ok(onTopic > 0, 'the seed rates options on special-colour');
    assert.ok(recFor(await suggest(['special-colour']), 'print-type'), 'counts before the delete');

    assert.equal((await del(`/api/admin/parameters/${t.id}`)).status, 204);

    assert.equal(await h.prisma.suggestionRating.count({ where: { topicKey: 'special-colour' } }), 0);
    assert.equal(await h.prisma.suggestionRating.count(), total - onTopic, 'other ratings stay');
    assert.equal(await h.prisma.suggestionOption.count(), options, 'options stay');
    const pub = (await h.api().get('/api/parameters')).body as { key: string }[];
    assert.ok(!pub.some((p) => p.key === 'special-colour'));
    assert.deepEqual((await suggest(['special-colour'])).recommendations, [], 'no longer counts');
    assert.equal((await del(`/api/admin/parameters/${t.id}`)).status, 404, 'second delete');
  });
});

// ---- visibility -------------------------------------------------------------------------------------------

describe('visibility', () => {
  let vis: Awaited<ReturnType<typeof param>>;
  let hidden: { id: string };

  before(async () => {
    await topic('vis-a');
    await topic('vis-b');
    hidden = await topic('vis-hidden');
    // Ratings chosen so the weights matter: A wins on vis-a, B on vis-b.
    vis = await param('Visibility Check', [
      { label: 'Option A', stars: { 'vis-a': 5, 'vis-b': 1, 'vis-hidden': 5 } },
      { label: 'Option B', stars: { 'vis-a': 2, 'vis-b': 5, 'vis-hidden': 1 } },
    ]);
    assert.equal((await put(`/api/admin/parameters/${hidden.id}`, { active: false })).status, 200);
  });

  it('public /api/parameters lists active topics only; the admin list has them all', async () => {
    const pub = ((await h.api().get('/api/parameters')).body as { key: string; active: boolean }[]).map((p) => p.key);
    assert.ok(pub.includes('vis-a'));
    assert.ok(!pub.includes('vis-hidden'));
    const all = (await get('/api/admin/parameters')).body as { key: string; active: boolean }[];
    assert.equal(all.find((p) => p.key === 'vis-hidden')?.active, false);
  });

  it('a hidden topic ranked alone recommends nothing', async () => {
    assert.equal(recFor(await suggest(['vis-hidden']), vis.key), undefined);
  });

  it('a hidden topic ranked below the others changes nothing', async () => {
    const without = await suggest(['vis-a', 'vis-b']);
    const withHidden = await suggest(['vis-a', 'vis-b', 'vis-hidden']);
    assert.deepEqual(recFor(withHidden, vis.key), recFor(without, vis.key));
  });

  // Hidden topics are skipped and the rest renumbered, so the visible ones keep the weights of ranks 1 and 2.
  it('a hidden topic ranked first gives the same recommendation as not ranking it', async () => {
    const summary = (r: SuggestionResult) => {
      const x = recFor(r, vis.key);
      return x && { recommended: x.recommended.label, stars: x.recommended.stars, others: x.others.map((o) => [o.label, o.stars]) };
    };
    const without = summary(await suggest(['vis-a', 'vis-b']));
    const withHidden = summary(await suggest(['vis-hidden', 'vis-a', 'vis-b']));
    assert.deepEqual(withHidden, without);
  });
});

// ---- cache -----------------------------------------------------------------------------------------------

describe('suggestion cache', () => {
  let cache: Awaited<ReturnType<typeof param>>;
  let cacheTopic: { id: string };
  const winner = async () => recFor(await suggest(['cache-a']), cache.key)?.recommended.label;

  before(async () => {
    cacheTopic = await topic('cache-a');
    cache = await param('Cache Check', [
      { label: 'X', stars: { 'cache-a': 5 } },
      { label: 'Y', stars: { 'cache-a': 3 } },
      { label: 'Z', stars: { 'cache-a': 2 } },
    ]);
  });

  it('control: a direct database write is not seen within the 60 s window (the cache is really on)', async () => {
    h.invalidateSuggestionCache(); // a fresh 60 s window starts with the next request
    assert.equal(await winner(), 'X');
    await h.prisma.suggestionRating.update({ where: { optionId_topicKey: { optionId: cache.options[1]!.id, topicKey: 'cache-a' } }, data: { stars: 5 } });
    await h.prisma.suggestionRating.update({ where: { optionId_topicKey: { optionId: cache.options[0]!.id, topicKey: 'cache-a' } }, data: { stars: 1 } });
    assert.equal(await winner(), 'X', 'still the cached result');
    h.invalidateSuggestionCache();
    assert.equal(await winner(), 'Y');
  });

  it('a rating change through the API shows at once', async () => {
    assert.equal(await winner(), 'Y'); // warm
    const res = await put(`/api/admin/suggestion-options/${cache.options[2]!.id}`, { ratings: { 'cache-a': { stars: 5, reason: null } } });
    assert.equal(res.status, 200);
    // Y and Z both 5 stars: the tie goes to admin order (Y first).
    const res2 = await put(`/api/admin/suggestion-options/${cache.options[1]!.id}`, { ratings: { 'cache-a': { stars: 4, reason: null } } });
    assert.equal(res2.status, 200);
    assert.equal(await winner(), 'Z');
  });

  it('disabling an option shows at once', async () => {
    assert.equal(await winner(), 'Z'); // warm
    assert.equal((await put(`/api/admin/suggestion-options/${cache.options[2]!.id}`, { enabled: false })).status, 200);
    const r = recFor(await suggest(['cache-a']), cache.key);
    assert.equal(r?.recommended.label, 'Y');
    assert.ok(!r?.others.some((o) => o.label === 'Z'), 'a disabled option is not even a runner-up');
  });

  it('hiding a topic shows at once, and so does showing it again', async () => {
    assert.ok(recFor(await suggest(['cache-a']), cache.key)); // warm
    assert.equal((await put(`/api/admin/parameters/${cacheTopic.id}`, { active: false })).status, 200);
    assert.equal(recFor(await suggest(['cache-a']), cache.key), undefined);
    assert.equal((await put(`/api/admin/parameters/${cacheTopic.id}`, { active: true })).status, 200);
    assert.equal(await winner(), 'Y');
  });

  it('disabling the parameter and deleting an option show at once', async () => {
    assert.equal((await put(`/api/admin/suggestion-parameters/${cache.id}`, { enabled: false })).status, 200);
    assert.equal(recFor(await suggest(['cache-a']), cache.key), undefined);
    assert.equal((await put(`/api/admin/suggestion-parameters/${cache.id}`, { enabled: true })).status, 200);
    assert.equal(await winner(), 'Y');
    assert.equal((await del(`/api/admin/suggestion-options/${cache.options[1]!.id}`)).status, 204);
    assert.equal(await winner(), 'X');
  });
});
