import { useMemo } from 'react';
import type { CurrentUser, QueueEntry, StopDemand } from '../types';
import { fetchDemand } from '../api/waiting';
import { fetchQueue } from '../api/requests';
import { usePolling } from './usePolling';
import { DRIVER_NAV, STUDENT_NAV, type NavEntry } from '../layouts/AppShell';

const EMPTY_DEMAND: StopDemand[] = [];
const EMPTY_QUEUE: QueueEntry[] = [];

/**
 * Live badge counts on the driver's navigation.
 *
 * Polled here, in the shell, rather than inside each screen: the driver
 * needs to see that four people are waiting while they are looking at
 * the request queue. A count that only updates on the screen it belongs
 * to is not worth showing.
 *
 * Students get no badges — nothing about their own check-in or requests
 * needs chasing.
 */
export function useNavCounts(user: CurrentUser | null): NavEntry[] {
  const isDriver = user?.role === 'driver';

  const { data: demand } = usePolling<StopDemand[]>(
    () => (isDriver ? fetchDemand() : Promise.resolve(EMPTY_DEMAND)),
    EMPTY_DEMAND,
  );

  const { data: queue } = usePolling<QueueEntry[]>(
    () => (isDriver ? fetchQueue() : Promise.resolve(EMPTY_QUEUE)),
    EMPTY_QUEUE,
  );

  return useMemo(() => {
    if (!isDriver) return STUDENT_NAV;

    const waiting = demand.reduce((sum, row) => sum + row.waitingCount, 0);
    const open = queue.filter((entry) => entry.status === 'open').length;

    return DRIVER_NAV.map((entry) => {
      if (entry.to === '/board') return { ...entry, count: waiting };
      if (entry.to === '/queue') return { ...entry, count: open };
      return entry;
    });
  }, [isDriver, demand, queue]);
}
