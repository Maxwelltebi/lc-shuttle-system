import { useEffect, useState } from 'react';
import type { Stop } from '../types';
import { fetchStops } from '../api/stops';

/** Route stops, ordered by their position in the loop. */
export function useStops() {
  const [stops, setStops] = useState<Stop[]>([]);

  useEffect(() => {
    let active = true;
    fetchStops().then((result) => {
      if (active) {
        setStops([...result].sort((a, b) => a.sequence - b.sequence));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return stops;
}
