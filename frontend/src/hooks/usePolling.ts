import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '../types';

/**
 * Poll an async function on an interval.
 *
 * Polling pauses while the tab is hidden: a phone in someone's pocket
 * should not burn battery asking where the bus is.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  initial: T,
  intervalMs = 10_000,
  resourceKey: string | null = null,
) {
  const [snapshot, setSnapshot] = useState({ key: resourceKey, data: initial });
  const requestVersion = useRef(0);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // A successful mutation supersedes reads started before it completed.
  const setData = useCallback((data: T) => {
    requestVersion.current += 1;
    setSnapshot({ key: resourceKey, data });
    setLoading(false);
    setError(null);
  }, [resourceKey]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    setSnapshot({ key: resourceKey, data: initialRef.current });
    setLoading(true);
    setError(null);

    async function tick() {
      const version = ++requestVersion.current;
      try {
        const result = await fetcherRef.current();
        if (active && version === requestVersion.current) {
          setSnapshot({ key: resourceKey, data: result });
          setError(null);
        }
      } catch (caught) {
        if (active && version === requestVersion.current) setError(caught as ApiError);
      } finally {
        if (active && version === requestVersion.current) setLoading(false);
      }
    }

    function schedule() {
      window.clearTimeout(timer);
      if (!active || document.hidden) return;
      timer = window.setTimeout(async () => {
        await tick();
        schedule();
      }, intervalMs);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        window.clearTimeout(timer);
      } else {
        void tick();
        schedule();
      }
    }

    void tick();
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, resourceKey]);

  return { data: snapshot.key === resourceKey ? snapshot.data : initial, loading, error, setData };
}
