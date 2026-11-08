import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiUnreachableError, CANT_REACH, REQUEST_TIMEOUT_MS, customerErrorText, publicApi } from './client';

/** Runs `fn` with `fetch` replaced. */
async function withFetch(fake: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = fake as unknown as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const reply = (status: number, json: () => Promise<unknown>) => ({ ok: status >= 200 && status < 300, status, json }) as unknown as Response;

/** A fetch that never answers on its own, only rejects when its signal aborts (like a stalled connection). */
const stalled = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort);
  });

test('a request cancelled while its body arrives is a cancel, not an empty result', async () => {
  // Before the fix this resolved with {} and Step 3 crashed reading `recommendations`.
  await withFetch(
    async () => reply(200, () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))),
    () => assert.rejects(publicApi.suggest({ priorities: [{ key: 'price', label: 'Price' }] }), { name: 'AbortError' }),
  );
});

test('a success whose body is not JSON (e.g. a Wi-Fi sign-in page) is an error, not an empty result', async () => {
  await withFetch(
    async () => reply(200, () => Promise.reject(new SyntaxError('bad json'))),
    () => assert.rejects(publicApi.parameters(), (e) => e instanceof ApiUnreachableError && e.reason === 'not-json'),
  );
});

test('an error status with a non-JSON body still reports its status', async () => {
  await withFetch(
    async () => reply(502, () => Promise.reject(new SyntaxError('bad json'))),
    () => assert.rejects(publicApi.parameters(), { status: 502, message: 'Request failed (502)' }),
  );
});

test('no network: a friendly error, never the browser text', async () => {
  await withFetch(
    async () => Promise.reject(new TypeError('Failed to fetch')),
    () =>
      assert.rejects(publicApi.parameters(), (e) => {
        assert.ok(e instanceof ApiUnreachableError && e.reason === 'network');
        assert.equal(customerErrorText(e, 'x'), CANT_REACH);
        return true;
      }),
  );
});

test('a stalled request gives up after the timeout', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withFetch(stalled, async () => {
      const pending = publicApi.parameters();
      mock.timers.tick(REQUEST_TIMEOUT_MS - 1);
      await Promise.resolve();
      mock.timers.tick(1);
      await assert.rejects(pending, (e) => e instanceof ApiUnreachableError && e.reason === 'timeout');
    });
  } finally {
    mock.timers.reset();
  }
});

test("the caller's signal still cancels (and a cancel is not reported as a timeout)", async () => {
  await withFetch(stalled, async () => {
    const ac = new AbortController();
    const pending = publicApi.suggest({ priorities: [{ key: 'price', label: 'Price' }] }, ac.signal);
    ac.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  });
  await withFetch(stalled, async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(publicApi.suggest({ priorities: [{ key: 'price', label: 'Price' }] }, ac.signal), { name: 'AbortError' });
  });
});

test('customer text: server messages pass through, 5xx and unreachable become the friendly line', () => {
  assert.equal(customerErrorText(new Error('Too many requests. Please wait a minute and try again.'), 'x'), 'Too many requests. Please wait a minute and try again.');
  assert.equal(customerErrorText(new ApiUnreachableError('slow', 'timeout'), 'x'), CANT_REACH);
  assert.equal(customerErrorText(new Error(''), 'Could not load'), 'Could not load');
});
