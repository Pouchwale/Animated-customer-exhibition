import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, type PriorityInput, type RecommendTopic, type SuggestionParameter } from '@pw/shared';
import { seedParameters, seedSuggestionParameters } from '../../prisma/seed-data.js';

const p = (...keys: string[]): PriorityInput[] => keys.map((key) => ({ key, label: key }));

/** One parameter whose options have topic → stars. */
function param(key: string, options: { label: string; stars: Record<string, number> }[]): SuggestionParameter {
  return {
    id: key,
    key,
    name: key,
    description: null,
    sortOrder: 1,
    enabled: true,
    options: options.map((o, i) => ({
      id: `${key}/${o.label}`,
      parameterId: key,
      label: o.label,
      description: null,
      sortOrder: i + 1,
      enabled: true,
      ratings: Object.entries(o.stars).map(([topicKey, stars]) => ({ topicKey, stars, reason: null })),
    })),
  };
}

const topic = (key: string, sortOrder: number, active = true): RecommendTopic => ({ key, name: key.toUpperCase(), sortOrder, active });

/** The seeded parameters and topics, as the API loads them. */
const seededParams: SuggestionParameter[] = seedSuggestionParameters.map((sp, i) => ({
  ...param(sp.key, []),
  sortOrder: i + 1,
  options: sp.options.map((o, j) => ({
    id: `${sp.key}/${o.label}`,
    parameterId: sp.key,
    label: o.label,
    description: o.description,
    sortOrder: j + 1,
    enabled: true,
    ratings: Object.entries(o.ratings).map(([topicKey, [stars, reason]]) => ({ topicKey, stars, reason })),
  })),
}));
const seededTopics = seedParameters.map((t, i) => ({ key: t.key, name: t.name, sortOrder: i + 1, active: true }));

describe('recommend(): which ranked topics count', () => {
  const world = [
    param('print-type', [
      { label: 'Hidden fan', stars: { hidden: 5, price: 1 } },
      { label: 'Cheap', stars: { hidden: 1, price: 4 } },
    ]),
  ];
  const topics = [topic('price', 1), topic('hidden', 2, false)];

  it('a ranked topic the admin has hidden is ignored', () => {
    const r = recommend(world, p('hidden', 'price'), topics).recommendations[0]!;
    assert.equal(r.recommended.label, 'Cheap');
    assert.equal(r.recommended.stars, 4, 'only price counts');
    assert.deepEqual(
      r.recommended.ratings.map((x) => [x.rank, x.key]),
      [[1, 'price']],
      'the hidden topic is not listed either; the rest are renumbered, so price becomes #1 (full weight)',
    );
    // Without the topic list every ranked key counts, as before.
    assert.equal(recommend(world, p('hidden', 'price')).recommendations[0]!.recommended.label, 'Hidden fan');
  });

  it('only unknown, hidden or "custom:" keys → no recommendations (but the breakdown is kept)', () => {
    const ranking = [{ key: 'custom:mine', label: 'Mine' }, ...p('nope', 'hidden')];
    const rated = [param('print-type', [{ label: 'A', stars: { 'custom:mine': 5, nope: 5, hidden: 5 } }])];
    const r = recommend(rated, ranking, topics);
    assert.deepEqual(r.recommendations, []);
    assert.deepEqual(
      r.breakdown.map((b) => b.key),
      ['custom:mine', 'nope', 'hidden'],
    );
    // One real topic in the list is enough.
    assert.equal(recommend(world, [...ranking, ...p('price')], topics).recommendations.length, 1);
  });

  it('ranks beyond 5 use the fallback weight (10)', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const all = keys.map((k, i) => topic(k, i + 1));
    const one = [param('x', [{ label: 'Late bloomer', stars: { a: 1, f: 5 } }])];
    const r = recommend(one, p(...keys), all);
    assert.deepEqual(r.breakdown[5], { rank: 6, key: 'f', label: 'f', level: 'LOW', weight: 10 });
    // (100×1 + 10×5) / (100 + 10) = 1.36
    assert.equal(r.recommendations[0]!.recommended.stars, 1.4);
    assert.equal(r.recommendations[0]!.recommended.matchPercent, 28);
  });
});

describe('recommend(): result shape', () => {
  it('matchPercent = round(stars × 20) from the rounded stars, for every ranking tried', () => {
    const keys = seededTopics.map((t) => t.key);
    const rankings = [p('price', 'moq'), p('moq', 'price'), p(...keys), p(...[...keys].reverse()), p('print-quality'), p('delivery-type', 'price', 'moq')];
    let checked = 0;
    for (const ranking of rankings) {
      for (const rec of recommend(seededParams, ranking, seededTopics).recommendations) {
        assert.equal(rec.recommended.matchPercent, Math.round(rec.recommended.stars * 20), `${rec.key} ${rec.recommended.stars}`);
        checked++;
      }
    }
    assert.ok(checked >= rankings.length);
  });

  it('others are slim: id, label and stars only, best first', () => {
    const rec = recommend(seededParams, p('price', 'moq'), seededTopics).recommendations.find((r) => r.key === 'print-type')!;
    assert.equal(rec.others.length, 4);
    for (const o of rec.others) assert.deepEqual(Object.keys(o).sort(), ['id', 'label', 'stars']);
    const stars = [rec.recommended.stars, ...rec.others.map((o) => o.stars)];
    assert.deepEqual(
      stars,
      [...stars].sort((a, b) => b - a),
    );
  });

  it('never changes its inputs (the server shares them between requests)', () => {
    const deepFreeze = <T>(x: T): T => {
      if (x && typeof x === 'object') {
        for (const v of Object.values(x)) deepFreeze(v);
        Object.freeze(x);
      }
      return x;
    };
    const params = structuredClone(seededParams);
    const ranking = p('special-colour', 'price', 'moq');
    const topics = [...structuredClone(seededTopics)].reverse(); // not in admin order
    const before = structuredClone({ params, ranking, topics });
    deepFreeze(params);
    deepFreeze(ranking);
    deepFreeze(topics);
    const first = recommend(params, ranking, topics); // frozen: any write would throw
    assert.deepEqual({ params, ranking, topics }, before);
    assert.deepEqual(recommend(params, ranking, topics), first, 'same answer every time');
  });
});
