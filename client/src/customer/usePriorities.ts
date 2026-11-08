import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Parameter } from '@pw/shared';
import { customerErrorText, publicApi, retryDelay } from '../api/client';
import { PRIORITIES_STORAGE_KEY as STORAGE_KEY, fromParameter, type BubbleItem } from './model';

/** What is kept between visits on this device: the ranking. */
interface Saved {
  order: string[];
}

/** The priority the customer last added, moved or removed; `n` counts up with every touch. */
export interface Touched {
  key: string;
  n: number;
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      return { order: Array.isArray(parsed.order) ? parsed.order : [] };
    }
  } catch {
    // Storage blocked or corrupt — start fresh.
  }
  return { order: [] };
}

/**
 * All customer-side state: which bubbles exist (named in the admin panel)
 * and the ranked order in the workspace (index 0 = priority 1).
 */
export function usePriorities() {
  const [parameters, setParameters] = useState<Parameter[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved] = useState(loadSaved);
  const [order, setOrder] = useState<string[]>(saved.order);
  const [touched, setTouched] = useState<Touched | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const touch = useCallback((key: string) => setTouched((t) => ({ key, n: (t?.n ?? 0) + 1 })), []);

  /** The latest topics request (older answers are ignored) and the automatic retries after a failure. */
  const load = useRef({ id: 0, failures: 0, timer: 0, done: false });

  /**
   * Ask for the topics. A failure retries by itself (2, 4, 8, then every 15 s); those retries are `quiet`:
   * the error stays on screen until one works. "Try again" starts over, showing "Loading…".
   */
  const loadParameters = useCallback((quiet: boolean) => {
    const l = load.current;
    window.clearTimeout(l.timer);
    const id = ++l.id;
    if (!quiet) {
      l.failures = 0;
      setLoadError(null);
    }
    publicApi.parameters().then(
      (p) => {
        if (id !== l.id) return;
        l.done = true;
        setParameters(p);
        setLoadError(null);
      },
      (e: unknown) => {
        if (id !== l.id) return;
        setLoadError(customerErrorText(e, 'Could not load the topics.'));
        l.timer = window.setTimeout(() => loadParameters(true), retryDelay(l.failures++));
      },
    );
  }, []);
  const retry = useCallback(() => loadParameters(false), [loadParameters]);

  useEffect(() => {
    const l = load.current;
    loadParameters(false);
    // Back online: try again now rather than at the next scheduled retry.
    const online = () => {
      if (l.done) return;
      l.failures = 0;
      loadParameters(true);
    };
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      window.clearTimeout(l.timer);
      l.id++; // an answer arriving after this is ignored
    };
  }, [loadParameters]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ order } satisfies Saved));
    } catch {
      // Non-critical convenience only.
    }
  }, [order]);

  /** Every bubble, as the admin set it up. */
  const bubbles = useMemo<BubbleItem[]>(() => (parameters ?? []).map(fromParameter), [parameters]);

  const byKey = useMemo(() => new Map(bubbles.map((b) => [b.key, b])), [bubbles]);

  // Drop saved keys whose parameter was removed by an admin.
  useEffect(() => {
    if (!parameters) return;
    setOrder((prev) => {
      const next = prev.filter((k) => byKey.has(k));
      return next.length === prev.length ? prev : next;
    });
  }, [parameters, byKey]);

  const selected = useMemo(() => order.map((k) => byKey.get(k)).filter((b): b is BubbleItem => !!b), [order, byKey]);

  const add = useCallback((key: string, atIndex?: number) => {
    if (!orderRef.current.includes(key)) touch(key);
    setOrder((prev) => {
      if (prev.includes(key)) return prev; // no duplicates
      const next = [...prev];
      next.splice(atIndex ?? next.length, 0, key);
      return next;
    });
  }, [touch]);

  const remove = useCallback(
    (key: string) => {
      touch(key);
      setOrder((prev) => prev.filter((k) => k !== key));
    },
    [touch],
  );
  const clear = useCallback(() => setOrder([]), []);

  const move = useCallback((from: number, to: number) => {
    const key = orderRef.current[from];
    if (key && from !== to) touch(key);
    setOrder((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, [touch]);

  return {
    loading: parameters === null && !loadError,
    loadError,
    retry,
    bubbles,
    byKey,
    order,
    selected,
    add,
    remove,
    clear,
    move,
    touched,
  };
}

export type PrioritiesState = ReturnType<typeof usePriorities>;
