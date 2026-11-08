import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIntroChoice, isIntroStyle, isTransitionSpeed, slugify, TEXT_LIMITS } from '@pw/shared';

/** The server's slugify before it moved to @pw/shared (routes/admin.ts and services/suggestionParameters.ts). */
const oldSlugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'parameter';

describe('slugify (shared)', () => {
  it('matches the old server behaviour', () => {
    const inputs = [
      'Delivery Time',
      'Print Type',
      '  --Hello__World--  ',
      'Café Crème',
      'ﬁne Ⅻ ①',
      'PET / AL / PE (3-ply foil)',
      'a'.repeat(100),
      `${'a'.repeat(59)} b`,
      '日本語',
      'Привет',
      '',
      '!!!',
      'İstanbul',
    ];
    for (const s of inputs) assert.equal(slugify(s), oldSlugify(s), JSON.stringify(s));
  });

  it('examples, including the "parameter" fallback for non-Latin or empty names', () => {
    assert.equal(slugify('Delivery Time'), 'delivery-time');
    // NFKD splits off accents; one inside a word becomes a dash (kept as it was).
    assert.equal(slugify('Café Crème'), 'cafe-cre-me');
    assert.equal(slugify('日本語'), 'parameter');
    assert.equal(slugify('Привет'), 'parameter');
    assert.equal(slugify('   '), 'parameter');
    assert.equal(slugify('x'.repeat(100)).length, TEXT_LIMITS.key);
  });
});

describe('shared limits and guards', () => {
  it('text limits are the documented ones', () => {
    assert.deepEqual(TEXT_LIMITS, { name: 40, label: 60, description: 200, key: 60 });
  });

  it('type guards accept the listed values only', () => {
    assert.ok(['rotate', 'pouches', 'dots', 'zip', 'tagline', 'classic'].every(isIntroChoice));
    assert.ok(!isIntroStyle('rotate') && isIntroStyle('classic'));
    assert.ok(['slow', 'normal', 'fast'].every(isTransitionSpeed));
    for (const bad of ['turbo', '', null, undefined, 3, 'Rotate']) {
      assert.ok(!isIntroChoice(bad) && !isTransitionSpeed(bad), String(bad));
    }
  });
});
