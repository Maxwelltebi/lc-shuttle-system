import type { Stop } from '../types';
import { STOPS } from '../config/stops';
import { isBackendConnected, request } from './client';

/**
 * The nine stops.
 *
 * Served from local config until the backend exists, because a map with
 * no stops is useless and these are real, published data — not mock
 * data. Once Mongo is seeded this returns the API result instead, and
 * no component notices the difference.
 */
export async function fetchStops(): Promise<Stop[]> {
  if (!isBackendConnected) return STOPS;
  return request<Stop[]>('/api/stops', { fallback: STOPS });
}
