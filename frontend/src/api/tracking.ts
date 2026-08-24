import type { Bus, ServiceStatus, StopArrival } from '../types';
import { request } from './client';

/**
 * Live tracking reads.
 *
 * Every call here is polled on a timer rather than pushed over a socket
 * — see README "Live updates: polling, not WebSockets". All of it sits
 * behind these functions so swapping transport later touches one file.
 */

/** Both buses. Empty until a driver goes on duty. */
export function fetchBuses() {
  return request<Bus[]>('/api/buses', { fallback: [] });
}

/**
 * Whether anything is running right now.
 *
 * Server-owned rather than computed in the browser: the device clock
 * can be wrong, and a student told "next departure 1:15" by a phone
 * that is twenty minutes off will miss the bus.
 */
export function fetchServiceStatus() {
  return request<ServiceStatus | null>('/api/service-status', { fallback: null });
}

/** Arrival estimates for every stop, for one bus. */
export function fetchArrivals(busId: string) {
  return request<StopArrival[]>(`/api/buses/${busId}/arrivals`, { fallback: [] });
}

/** Driver on-duty toggle. */
export function setOnDuty(busId: string, onDuty: boolean) {
  return request<Bus | null>(`/api/buses/${busId}/duty`, {
    method: 'POST',
    body: JSON.stringify({ onDuty }),
    fallback: null,
  });
}

/** Driver's next-stop selection — what students read as "where it's going". */
export function setNextStop(busId: string, stopId: string) {
  return request<Bus | null>(`/api/buses/${busId}/next-stop`, {
    method: 'POST',
    body: JSON.stringify({ stopId }),
    fallback: null,
  });
}

/** Position ping from the driver's device, every 10 seconds while on duty. */
export function pingPosition(
  busId: string,
  position: { lat: number; lng: number; accuracyMeters: number | null },
) {
  return request<null>(`/api/buses/${busId}/ping`, {
    method: 'POST',
    body: JSON.stringify(position),
    fallback: null,
  });
}
