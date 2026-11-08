/**
 * A memoized async load, kept for `ttlMs`. Callers during a load share it (a burst of requests runs one query),
 * a failed load is dropped so the next call retries, and `invalidate()` makes the next call load afresh.
 */
export function cachedLoad<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let entry: { at: number; promise: Promise<T> } | null = null;

  const invalidate = () => {
    entry = null;
  };

  const get = (): Promise<T> => {
    if (entry && now() - entry.at < ttlMs) return entry.promise;
    const current = { at: now(), promise: load() };
    entry = current;
    // Don't keep a failure (and don't drop a newer load that replaced this one).
    current.promise.catch(() => {
      if (entry === current) invalidate();
    });
    return current.promise;
  };

  return { get, invalidate };
}
