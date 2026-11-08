import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from '../api/client';
import { errorText, useAdmin } from './ui';

interface CrudApi<T, D> {
  list: () => Promise<T[]>;
  create: (data: D) => Promise<T>;
  update: (id: string, data: Partial<D>) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

/** List + create/update/remove against one admin resource, keeping local state in sync. */
export function useCrud<T extends { id: string }, D>(api: CrudApi<T, D>) {
  const { items, setData, loading, error, reload } = useAsync(api.list, [] as T[]);

  const create = useCallback(
    async (data: D) => {
      const item = await api.create(data);
      setData((xs) => [...xs, item]);
      return item;
    },
    [api, setData],
  );

  const update = useCallback(
    async (id: string, data: Partial<D>) => {
      const item = await api.update(id, data);
      setData((xs) => xs.map((x) => (x.id === id ? item : x)));
      return item;
    },
    [api, setData],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.remove(id);
      setData((xs) => xs.filter((x) => x.id !== id));
    },
    [api, setData],
  );

  return { items, loading, error, reload, create, update, remove };
}

/** Loads one value on mount, with loading/error state and a reload function. */
export function useAsync<T>(load: () => Promise<T>, initial: T) {
  const [items, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { reportError } = useAdmin();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      // An expired session sends the user back to the login screen.
      if (err instanceof ApiRequestError && err.status === 401) reportError(err);
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [load, reportError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, setData, loading, error, reload };
}
