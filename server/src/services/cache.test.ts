import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cachedLoad } from './cache.js';

/** A loader that counts its calls and resolves (or rejects) when told to. */
function fakeLoader() {
  const calls: { resolve: (v: number) => void; reject: (e: Error) => void }[] = [];
  const load = () => new Promise<number>((resolve, reject) => calls.push({ resolve, reject }));
  return { load, calls };
}

describe('cachedLoad (the suggestion engine context cache)', () => {
  it('a burst of callers shares one load', async () => {
    const { load, calls } = fakeLoader();
    const cache = cachedLoad(load, 60_000);
    const all = Promise.all([cache.get(), cache.get(), cache.get()]);
    assert.equal(calls.length, 1);
    calls[0]!.resolve(7);
    assert.deepEqual(await all, [7, 7, 7]);
    assert.equal(await cache.get(), 7);
    assert.equal(calls.length, 1, 'still cached');
  });

  it('reloads after the TTL', async () => {
    let t = 0;
    let n = 0;
    const cache = cachedLoad(async () => ++n, 60_000, () => t);
    assert.equal(await cache.get(), 1);
    t = 59_999;
    assert.equal(await cache.get(), 1);
    t = 60_000;
    assert.equal(await cache.get(), 2);
  });

  it('invalidate() makes the next call load afresh', async () => {
    let n = 0;
    const cache = cachedLoad(async () => ++n, 60_000);
    assert.equal(await cache.get(), 1);
    cache.invalidate();
    assert.equal(await cache.get(), 2);
    assert.equal(await cache.get(), 2);
  });

  it('an invalidate() during a load is not undone when that load finishes', async () => {
    const { load, calls } = fakeLoader();
    const cache = cachedLoad(load, 60_000);
    const stale = cache.get();
    cache.invalidate(); // an admin saved while the load was running
    calls[0]!.resolve(1);
    assert.equal(await stale, 1);
    const fresh = cache.get();
    assert.equal(calls.length, 2, 'the stale result was not kept');
    calls[1]!.resolve(2);
    assert.equal(await fresh, 2);
  });

  it('a failed load is not cached; a newer load is not dropped by an older failure', async () => {
    const { load, calls } = fakeLoader();
    const cache = cachedLoad(load, 60_000);
    const failed = cache.get();
    calls[0]!.reject(new Error('db down'));
    await assert.rejects(failed, /db down/);
    const retry = cache.get();
    assert.equal(calls.length, 2, 'retried');
    calls[1]!.resolve(5);
    assert.equal(await retry, 5);

    const old = cache.get(); // cached: no new load
    assert.equal(calls.length, 2);
    assert.equal(await old, 5);
    cache.invalidate();
    const a = cache.get(); // load #3
    cache.invalidate();
    const b = cache.get(); // load #4 replaces it
    calls[2]!.reject(new Error('late failure'));
    await assert.rejects(a);
    calls[3]!.resolve(9);
    assert.equal(await b, 9);
    assert.equal(await cache.get(), 9, 'the older failure did not drop the newer load');
    assert.equal(calls.length, 4);
  });
});
