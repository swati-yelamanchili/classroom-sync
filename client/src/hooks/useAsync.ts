import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';

/** Load data on mount and on demand, ignoring responses that a newer load has superseded. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const stableLoad = useCallback(load, deps);

  const reload = useCallback(async () => {
    const id = (latest.current += 1);
    setLoading(true);
    try {
      const result = await stableLoad();
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(errorMessage(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [stableLoad]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Classroom Sync`;
  }, [title]);
}
