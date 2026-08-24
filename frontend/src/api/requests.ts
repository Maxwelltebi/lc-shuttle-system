import type { QueueEntry, RideRequest, RideSchedule } from '../types';
import { request } from './client';

/** Module 3 — special ride requests. */

/** The student's own requests, newest first. */
export function fetchMyRequests() {
  return request<RideRequest[]>('/api/requests/mine', { fallback: [] });
}

export interface CreateRequestInput {
  destination: string;
  pickupStopId: string | null;
  pickupLabel: string;
  /** ISO timestamp combining the date and time fields. */
  requestedAt: string;
}

export function createRequest(input: CreateRequestInput) {
  return request<RideRequest | null>('/api/requests', {
    method: 'POST',
    body: JSON.stringify(input),
    fallback: null,
  });
}

/** Open requests both drivers can see, oldest first (FR3.2). */
export function fetchQueue() {
  return request<QueueEntry[]>('/api/requests/queue', { fallback: [] });
}

/**
 * Claim a request (FR3.3, FR3.4).
 *
 * The server performs a conditional update and returns `claim_conflict`
 * when zero rows change, meaning the other driver got there first. The
 * losing driver must be told — a silent no-op would leave them believing
 * they had the trip.
 */
export function claimRequest(requestId: string) {
  return request<RideRequest | null>(`/api/requests/${requestId}/claim`, {
    method: 'POST',
    fallback: null,
  });
}

export interface ScheduleInput {
  /** ISO timestamp of the agreed trip. */
  tripAt: string;
}

/**
 * Submit the schedule and email it to the student (FR3.6, FR3.7).
 *
 * The response carries `emailStatus`: a schedule saved but not delivered
 * is not a success, and the driver has to know.
 */
export function scheduleRequest(requestId: string, input: ScheduleInput) {
  return request<RideSchedule | null>(`/api/requests/${requestId}/schedule`, {
    method: 'POST',
    body: JSON.stringify(input),
    fallback: null,
  });
}

/** Retry a failed schedule email. */
export function resendSchedule(scheduleId: string) {
  return request<RideSchedule | null>(`/api/schedules/${scheduleId}/resend`, {
    method: 'POST',
    fallback: null,
  });
}
