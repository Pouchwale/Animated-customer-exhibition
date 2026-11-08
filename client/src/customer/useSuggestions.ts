import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuggestionResult } from '@pw/shared';
import { customerErrorText, isTransient, publicApi, retryDelay } from '../api/client';
import type { BubbleItem } from './model';

const DEBOUNCE_MS = 280;

/**
 * Step 2 → Step 3: sends the exact ranked list (index 0 = priority 1) and asks again whenever its order,
 * topics or labels change. The last result stays on screen while the next one loads; `stale` says it
 * belongs to an earlier ranking, so Step 3 never passes it off as the answer to the current one.
 *
 * A failed request for the current ranking sets `error` and retries by itself (2, 4, 8, then every 15 s,
 * and straight away when the device is back online). Those retries are quiet: the error stays up until one
 * works. A new ranking or `retry()` clears it at once.
 */
export function useSuggestions(selected: BubbleItem[]) {
  /** The last result, with the ranking it answers. */
  const [shown, setShown] = useState<{ data: SuggestionResult; signature: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to ask again for the same ranking; `quiet` keeps the current error up meanwhile. */
  const [attempt, setAttempt] = useState({ n: 0, quiet: false });
  const live = useRef({ shown, error, signature: '', failures: 0, retryTimer: 0 });
  live.current.shown = shown;
  live.current.error = error;

  // Stable signature: only refetch when keys, order or labels actually change.
  const signature = JSON.stringify(selected.map((b) => [b.key, b.name]));

  // Pick up the admin's changes (ratings, options) when the customer comes back to the tab, and try again
  // as soon as the device is back online after a failure.
  useEffect(() => {
    const again = () => setAttempt((a) => ({ n: a.n + 1, quiet: true }));
    const refresh = () => {
      if (document.visibilityState === 'visible') again();
    };
    const online = () => {
      if (!live.current.error) return;
      live.current.failures = 0;
      again();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', online);
      window.clearTimeout(live.current.retryTimer);
    };
  }, []);

  useEffect(() => {
    const l = live.current;
    window.clearTimeout(l.retryTimer);
    if (selected.length === 0) {
      setShown(null);
      setLoading(false);
      setError(null);
      l.failures = 0;
      l.signature = signature;
      return;
    }
    const fresh = signature !== l.signature;
    l.signature = signature;
    if (fresh) l.failures = 0;
    // A new ranking (or Try again) starts clean; a quiet retry keeps the error up until it works.
    if (fresh || !attempt.quiet) setError(null);
    setLoading(true);
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      publicApi
        .suggest({ priorities: selected.map((b) => ({ key: b.key, label: b.name })) }, ac.signal)
        .then((r) => {
          if (ac.signal.aborted) return; // a newer ranking is already on its way
          l.failures = 0;
          setShown({ data: r, signature });
          setError(null);
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
          // A background refresh failed but this very ranking's result is already showing: keep it, say nothing.
          if (l.shown?.signature === signature) return;
          setError(customerErrorText(e, 'Could not load your recommendations.'));
          // Retry by itself only when it can help; a rejected request stays as is (the Retry button still works).
          if (isTransient(e)) l.retryTimer = window.setTimeout(() => setAttempt((a) => ({ n: a.n + 1, quiet: true })), retryDelay(l.failures++));
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
    // `selected` is read through `signature` (same keys, order and labels).
  }, [signature, attempt]);

  /** Try again now (the customer pressed Retry): clears the error and starts the retries over. */
  const retry = useCallback(() => {
    live.current.failures = 0;
    setAttempt((a) => ({ n: a.n + 1, quiet: false }));
  }, []);

  const data = shown?.data ?? null;
  return { data, stale: !!shown && shown.signature !== signature, loading, error, retry };
}
