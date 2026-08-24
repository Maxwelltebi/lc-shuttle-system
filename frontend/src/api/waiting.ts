import type { StopDemand, WaitingCheckIn } from '../types';
import { request } from './client';

/** Module 2 — waiting check-ins and the driver's demand board. */

/** The signed-in student's active check-in, or null. */
export function fetchMyCheckIn() {
  return request<WaitingCheckIn | null>('/api/waiting/me', { fallback: null });
}

/**
 * Check in at a stop.
 *
 * A student holds at most one active check-in (FR2.2), so the server
 * replaces any existing one rather than the client deleting first —
 * two round trips could leave a student checked in twice.
 */
export function checkIn(stopId: string) {
  return request<WaitingCheckIn | null>('/api/waiting', {
    method: 'POST',
    body: JSON.stringify({ stopId }),
    fallback: null,
  });
}

/** Student withdraws their own check-in (FR2.3). */
export function withdrawCheckIn(checkInId: string) {
  return request<null>(`/api/waiting/${checkInId}`, {
    method: 'DELETE',
    fallback: null,
  });
}

/**
 * The driver's board: one row per stop with its live count.
 *
 * Counts come from the server so the 1h30m expiry is applied at read
 * time in one place (FR2.6). A browser computing it from timestamps
 * would drift from what the server believes.
 */
export function fetchDemand() {
  return request<StopDemand[]>('/api/waiting/demand', { fallback: [] });
}

/** Bulk-clear every active check-in at one stop (FR2.5). */
export function clearStop(stopId: string) {
  return request<StopDemand | null>(`/api/waiting/demand/${stopId}/clear`, {
    method: 'POST',
    fallback: null,
  });
}
