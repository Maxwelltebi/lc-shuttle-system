import { useEffect, useState } from 'react';
import type { Bus } from '../types';
import { fetchBuses } from '../api/tracking';
import { useSession } from './useSession';

/**
 * The signed-in driver's own bus.
 *
 * `GET /api/buses` belongs to the student map: it returns the whole
 * fleet, unsorted. Taking `buses[0]` therefore hands every driver Bus 1,
 * and the server rejects the drivers it does not belong to with "That is
 * not your bus" — while the driver of Bus 1 never notices. The driver's
 * own bus id is already on the session, so match on it.
 *
 * `loading` separates "still fetching" from "no bus assigned", which are
 * both `null` but mean opposite things to a driver.
 */
export function useMyBus() {
  const { user } = useSession();
  const busId = user?.role === 'driver' ? user.busId : null;

  const [bus, setBus] = useState<Bus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!busId) {
      setBus(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    fetchBuses()
      .then((buses) => {
        if (active) setBus(buses.find((entry) => entry.id === busId) ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [busId]);

  return { bus, setBus, loading };
}
