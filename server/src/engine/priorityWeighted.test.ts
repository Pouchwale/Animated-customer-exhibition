import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { levelForRank, weightForRank, type PriorityInput, type SuggestionParameter } from '@pw/shared';
import { seedParameters, seedSuggestionParameters } from '../../prisma/seed-data.js';
import { suggest } from './priorityWeighted.js';

const NOW = new Date('2026-10-31T00:00:00Z');
const labelOf = (key: string) => seedParameters.find((p) => p.key === key)?.name ?? key;
const p = (...keys: string[]): PriorityInput[] => keys.map((key) => ({ key, label: labelOf(key) }));

/** The seeded recommendation parameters (options rated 1–5 stars per topic), as the API would return them. */
const seeded: SuggestionParameter[] = seedSuggestionParameters.map((param, i) => ({
  id: param.key,
  key: param.key,
  name: param.name,
  description: param.description,
  sortOrder: i + 1,
  enabled: true,
  options: param.options.map((o, j) => ({
    id: `${param.key}/${o.label}`,
    parameterId: param.key,
    label: o.label,
    description: o.description,
    sortOrder: j + 1,
    enabled: true,
    ratings: Object.entries(o.ratings).map(([topicKey, [stars, reason]]) => ({ topicKey, stars, reason })),
  })),
}));

function run(priorities: PriorityInput[], parameters: SuggestionParameter[] = seeded) {
  return suggest(priorities, { parameters }, NOW);
}
const pick = (result: ReturnType<typeof run>, key: string) => result.recommendations.find((r) => r.key === key);

/** Minimal one-parameter world: options with topic → stars. */
function param(
  key: string,
  options: { label: string; stars: Record<string, number>; enabled?: boolean }[],
  extra: Partial<SuggestionParameter> = {},
): SuggestionParameter {
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
      enabled: o.enabled ?? true,
      ratings: Object.entries(o.stars).map(([topicKey, stars]) => ({ topicKey, stars, reason: `${o.label} on ${topicKey}` })),
    })),
    ...extra,
  };
}

describe('weights & levels', () => {
  it('uses the weight list, then the fallback weight', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7].map((r) => weightForRank(r)),
      [100, 80, 60, 40, 20, 10, 10],
    );
  });
  it('maps ranks to HIGH / MEDIUM / LOW', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((r) => levelForRank(r)),
      ['HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'LOW'],
    );
  });
  it('returns one breakdown row per ranked topic', () => {
    const r = run(p('price', 'print-quality', 'moq'));
    assert.deepEqual(
      r.breakdown.map((b) => [b.rank, b.key, b.level, b.weight]),
      [
        [1, 'price', 'HIGH', 100],
        [2, 'print-quality', 'HIGH', 80],
        [3, 'moq', 'MEDIUM', 60],
      ],
    );
    assert.equal(r.engine, 'priority-weighted');
    assert.equal(r.generatedAt, NOW.toISOString());
  });
});

describe('star ratings decide the winner', () => {
  it('fit = Σ weight × stars ÷ Σ weight; the best fit wins', () => {
    const world = [
      param('print-type', [
        { label: 'Flexo', stars: { price: 2, moq: 5, 'print-quality': 4 } },
        { label: 'Gravure', stars: { price: 5, moq: 1, 'print-quality': 5 } },
      ]),
    ];
    // Flexo (100×2 + 80×5 + 60×4)/240 = 3.5; Gravure (500 + 80 + 300)/240 = 3.67
    const r = pick(run(p('price', 'moq', 'print-quality'), world), 'print-type')!;
    assert.equal(r.recommended.label, 'Gravure');
    assert.equal(r.recommended.stars, 3.7);
    assert.equal(r.recommended.matchPercent, 74, 'from the rounded stars: 3.7 × 20');
    assert.equal(r.others[0].label, 'Flexo');
    assert.equal(r.others[0].stars, 3.5);
    // MOQ first changes it: Flexo (500 + 160 + 240)/240 = 3.75, Gravure (100 + 400 + 300)/240 = 3.33
    assert.equal(pick(run(p('moq', 'price', 'print-quality'), world), 'print-type')!.recommended.label, 'Flexo');
  });

  it('the why: each ranked priority with its stars and reason, in the customer’s order', () => {
    const world = [param('print-type', [{ label: 'Flexo', stars: { price: 2, moq: 5, 'print-quality': 4 } }])];
    const rec = pick(run(p('price', 'moq', 'print-quality'), world), 'print-type')!.recommended;
    assert.deepEqual(
      rec.ratings.map((x) => [x.rank, x.key, x.stars, x.reason]),
      [
        [1, 'price', 2, 'Flexo on price'],
        [2, 'moq', 5, 'Flexo on moq'],
        [3, 'print-quality', 4, 'Flexo on print-quality'],
      ],
    );
  });

  it('only topics the parameter rates count; custom bubbles never do', () => {
    const world = [param('print-type', [{ label: 'A', stars: { price: 4 } }])];
    const r = pick(run([{ key: 'custom:my-topic', label: 'Mine' }, ...p('delivery-type', 'price')], world), 'print-type')!;
    assert.equal(r.recommended.stars, 4, 'unrated Delivery Type and the custom bubble don’t dilute it');
    assert.deepEqual(
      r.recommended.ratings.map((x) => [x.key, x.rank]),
      [['price', 3]],
    );
  });

  it('an option not rated on a ranked topic counts 0 stars for it', () => {
    const world = [
      param('print-type', [
        { label: 'Only price', stars: { price: 5 } },
        { label: 'Both', stars: { price: 3, moq: 3 } },
      ]),
    ];
    // Only price: (100×5 + 80×0)/180 = 2.78; Both: (300 + 240)/180 = 3
    const r = pick(run(p('price', 'moq'), world), 'print-type')!;
    assert.equal(r.recommended.label, 'Both');
    assert.deepEqual(r.others[0], { id: 'print-type/Only price', label: 'Only price', stars: 2.8 }, 'not 5: its missing MOQ counts as 0');
    // Against a weaker rival "Only price" wins, and its why lists MOQ as not rated.
    const weaker = [
      param('print-type', [
        { label: 'Only price', stars: { price: 5 } },
        { label: 'Low', stars: { price: 1, moq: 1 } },
      ]),
    ];
    const alone = pick(run(p('price', 'moq'), weaker), 'print-type')!;
    assert.equal(alone.recommended.label, 'Only price');
    assert.deepEqual(alone.recommended.ratings[1], { rank: 2, key: 'moq', label: 'MOQ', stars: 0, reason: null });
  });

  it('ties: more stars on the higher-ranked topic, then admin order', () => {
    const world = [
      param('print-type', [
        { label: 'MOQ strong', stars: { moq: 5 } },
        { label: 'Price strong', stars: { price: 4 } },
      ]),
    ];
    // Equal fit: 80×5 = 100×4 = 400. Price is #1 → Price strong wins.
    assert.equal(pick(run(p('price', 'moq'), world), 'print-type')!.recommended.label, 'Price strong');
    const same = [
      param('print-type', [
        { label: 'First', stars: { price: 3 } },
        { label: 'Second', stars: { price: 3 } },
      ]),
    ];
    assert.equal(pick(run(p('price'), same), 'print-type')!.recommended.label, 'First');
  });

  it('hidden options and parameters are skipped; nothing rated → no card', () => {
    const world = [
      param('print-type', [
        { label: 'Hidden best', stars: { price: 5 }, enabled: false },
        { label: 'Shown', stars: { price: 2 } },
      ]),
      param('finish', [{ label: 'Matte', stars: { 'special-colour': 4 } }], { sortOrder: 2 }),
      param('off', [{ label: 'X', stars: { price: 5 } }], { enabled: false, sortOrder: 3 }),
    ];
    const r = run(p('price'), world);
    assert.equal(pick(r, 'print-type')!.recommended.label, 'Shown');
    assert.equal(pick(r, 'print-type')!.others.length, 0);
    assert.equal(pick(r, 'finish'), undefined, 'no ranked topic is rated for it');
    assert.equal(pick(r, 'off'), undefined);
  });
});

describe('every priority is listed, only the ranked ones count', () => {
  it('ranked first (with rank), then the other active topics in admin order (rank null); the fit is unchanged', () => {
    const world = [param('print-type', [{ label: 'Flexo', stars: { price: 2, moq: 5, 'print-quality': 4, 'delivery-type': 3 } }])];
    const topics = [
      { key: 'price', name: 'Price', sortOrder: 1, active: true },
      { key: 'moq', name: 'MOQ', sortOrder: 2, active: true },
      { key: 'delivery-type', name: 'Delivery Type', sortOrder: 3, active: true },
      { key: 'print-quality', name: 'Print Quality', sortOrder: 5, active: true },
      { key: 'special-colour', name: 'Special Colour', sortOrder: 6, active: true },
      { key: 'hidden', name: 'Hidden', sortOrder: 7, active: false },
    ];
    const withAll = suggest(p('moq', 'price'), { parameters: world, topics }, NOW).recommendations[0].recommended;
    assert.deepEqual(
      withAll.ratings.map((r) => [r.rank, r.label, r.stars]),
      [
        [1, 'MOQ', 5],
        [2, 'Price', 2],
        [null, 'Delivery Type', 3],
        [null, 'Print Quality', 4],
        [null, 'Special Colour', 0],
      ],
      'hidden topics are left out; unrated ones show 0',
    );
    const rankedOnly = suggest(p('moq', 'price'), { parameters: world }, NOW).recommendations[0].recommended;
    assert.equal(withAll.stars, rankedOnly.stars, 'unranked topics never change the score');
    assert.equal(withAll.stars, 3.7); // (100×5 + 80×2)/180
  });
});

describe('the seeded print types (your examples)', () => {
  it('Price #1, MOQ #2, Print Quality #3: the stars weigh all three', () => {
    const r = pick(run(p('price', 'moq', 'print-quality')), 'print-type')!;
    // Flexo (400 + 240 + 300)/240 = 3.92; Gravure (500 + 80 + 300)/240 = 3.67; Digital (200 + 400 + 240)/240 = 3.5
    assert.equal(r.recommended.label, 'Flexo Printing');
    assert.deepEqual(
      r.recommended.ratings.map((x) => [x.label, x.stars]),
      [
        ['Price', 4],
        ['MOQ', 3],
        ['Print Quality', 5],
      ],
    );
    assert.ok(
      r.recommended.ratings.every((x) => x.reason),
      'every rating has a reason',
    );
  });

  it('MOQ first → Digital; Price alone → Gravure', () => {
    assert.equal(pick(run(p('moq', 'price')), 'print-type')!.recommended.label, 'Digital Printing');
    assert.equal(pick(run(p('price')), 'print-type')!.recommended.label, 'Gravure Printing');
  });

  it('every seeded option is rated on every seeded topic, 1–5 stars', () => {
    for (const param of seedSuggestionParameters) {
      for (const o of param.options) {
        const keys = Object.keys(o.ratings).sort();
        assert.deepEqual(keys, seedParameters.map((t) => t.key).sort(), `${param.key}/${o.label}`);
        assert.ok(Object.values(o.ratings).every(([s]) => s >= 1 && s <= 5));
      }
    }
  });
});
