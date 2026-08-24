import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../types';

/**
 * Poll an async function on an interval.
 *
 * This is the single place the app's "live" behaviour lives. Replacing
 * polling with WebSockets later means rewriting this hook and nothing
 * else — no screen knows how its data arrives.
 *
 * Polling pauses while the tab is hidden: a phone in someone's pocket
 * should not burn battery asking where the bus is.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  initial: T,
  intervalMs = 10_000,
) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    async function tick() {
      try {
        const result = await fetcherRef.current();
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (caught) {
        if (active) setError(caught as ApiError);
      } finally {
        if (active) setLoading(false);
      }
    }

    function schedule() {
      window.clearTimeout(timer);
      if (document.hidden) return;
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
  }, [intervalMs]);

  return { data, loading, error };
}
