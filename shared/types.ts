/**
 * LC Shuttle — shared types.
 *
 * This file IS the frontend/backend contract. Every shape the React app
 * expects from Express is declared here. If the API returns something
 * different, TypeScript fails the build rather than the UI failing at
 * runtime in front of a student standing at a bus stop.
 *
 * Timestamps are ISO 8601 strings (`2026-08-24T12:30:00-04:00`), never
 * Date objects — JSON has no date type, and Mongo's driver and the
 * browser disagree about timezones often enough to matter.
 */

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export type Role = 'student' | 'driver';

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Stop chosen at signup. Seeds the "I'm waiting" default and the
   *  personalised no-service message. Nullable: older accounts, or a
   *  student who skipped it. */
  homeStopId: string | null;
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Assigned by transportation staff, never chosen by the driver. */
  busId: string | null;
  /** Driver accounts require staff approval before they can go on duty.
   *  Without this, anyone with a school email could broadcast fake bus
   *  positions. */
  approved: boolean;
}

export type CurrentUser =
  | ({ role: 'student' } & Student)
  | ({ role: 'driver' } & Driver);

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export interface Stop {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Position in the one-way loop, 1..n. Drives waiting-board order and
   *  ETA sequencing. A bus at stop 5 reaches stop 7 after passing 6,
   *  regardless of straight-line distance. */
  sequence: number;
}

/* ------------------------------------------------------------------ */
/* Buses and live tracking                                             */
/* ------------------------------------------------------------------ */

export type BusStatus = 'live' | 'offline' | 'off_duty';

export interface Bus {
  id: string;
  /** "Bus 1" */
  label: string;
  status: BusStatus;
  onDuty: boolean;
  /** Null whenever the bus has never pinged, or is off duty. */
  position: BusPosition | null;
  /** The stop the driver selected as their next destination. */
  nextStopId: string | null;
  /** Minutes behind (positive) or ahead (negative) of the published
   *  timetable. Null when unknown. */
  scheduleOffsetMinutes: number | null;
}

export interface BusPosition {
  lat: number;
  lng: number;
  /** ISO timestamp. Older than 2 minutes ⇒ status becomes `offline`
   *  and the pin renders greyed out rather than at a stale point. */
  lastPingAt: string;
  /** GPS accuracy in metres, shown on the driver's on-duty screen. */
  accuracyMeters: number | null;
}

/** One row in the arrivals list. The server computes these because it
 *  owns both the timetable offsets and the live positions. */
export interface StopArrival {
  stopId: string;
  busId: string;
  /** Minutes until arrival. Null outside service hours. */
  etaMinutes: number | null;
  /** Clock time, e.g. "2:22 PM". Null when no estimate is available. */
  etaClock: string | null;
  /** Scheduled clock time from the printed timetable. Always present
   *  during service hours, so the UI can fall back to it when a bus
   *  goes offline. */
  scheduledClock: string | null;
}

/* ------------------------------------------------------------------ */
/* Service hours                                                       */
/* ------------------------------------------------------------------ */

export type ServiceState = 'in_service' | 'lunch_break' | 'closed';

export interface ServiceStatus {
  state: ServiceState;
  /** "1:15 PM" — the next departure from Horseshoe Gate. Null once the
   *  last loop of the day has gone. */
  nextDepartureClock: string | null;
  /** Human-readable reason, rendered directly:
   *  "Driver lunch break. Nothing on the road right now." */
  message: string;
}

/* ------------------------------------------------------------------ */
/* Module 2 — waiting check-ins                                        */
/* ------------------------------------------------------------------ */

export type CheckInStatus = 'waiting' | 'withdrawn' | 'picked_up' | 'expired';

export interface WaitingCheckIn {
  id: string;
  studentId: string;
  stopId: string;
  status: CheckInStatus;
  createdAt: string;
  /** createdAt + 1h30m. Rendered as "clears automatically at 3:34 PM".
   *  Server-supplied so the countdown cannot drift from the server's
   *  read-time expiry rule. */
  expiresAt: string;
}

/** One card on the driver's waiting board. */
export interface StopDemand {
  stopId: string;
  waitingCount: number;
  /** ISO timestamp of the longest-waiting check-in, shown as
   *  "oldest 14 min ago". Null when the count is zero. */
  oldestCheckInAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Module 3 — special ride requests                                    */
/* ------------------------------------------------------------------ */

export type RideRequestStatus = 'open' | 'claimed' | 'scheduled' | 'expired';

export interface RideRequest {
  id: string;
  /** Human-facing reference shown on the student's list, e.g. "RR-1042". */
  reference: string;
  studentId: string;
  /** Free text — off-route by definition, so not a Stop reference. */
  destination: string;
  /** A Stop id when the student picked one from the list. */
  pickupStopId: string | null;
  pickupLabel: string;
  requestedAt: string;
  status: RideRequestStatus;
  claimedByDriverId: string | null;
  claimedAt: string | null;
  createdAt: string;
  /** Present once status is `scheduled`. */
  schedule: RideSchedule | null;
}

export interface RideSchedule {
  id: string;
  rideRequestId: string;
  driverId: string;
  tripAt: string;
  destination: string;
  pickupLabel: string;
  /** Null means the email has not been sent — either not yet attempted
   *  or the send failed. The driver must be told; a schedule the
   *  student never receives is the same as no schedule. */
  sentAt: string | null;
  emailStatus: EmailStatus;
}

export type EmailStatus = 'pending' | 'sent' | 'failed';

/** Denormalised queue row, so the driver's list does not need a second
 *  round-trip per request to show the student's name. */
export interface QueueEntry extends RideRequest {
  studentName: string;
}

/* ------------------------------------------------------------------ */
/* API plumbing                                                        */
/* ------------------------------------------------------------------ */

export interface AuthSession {
  token: string;
  user: CurrentUser;
}

/**
 * Every failure the UI distinguishes.
 *
 * `claim_conflict` matters most: two drivers tapping Claim at the same
 * instant must resolve to exactly one winner (FR3.4). The server does
 * this with a conditional update; when zero rows change it returns this
 * code, and the losing driver is told the request is already claimed
 * rather than seeing a silent no-op.
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'claim_conflict'
  | 'email_failed'
  | 'not_approved'
  | 'network'
  | 'server_error';

export interface ApiError {
  code: ApiErrorCode;
  /** Safe to render directly to the user. */
  message: string;
  /** Field-level messages for form validation, keyed by field name. */
  fields?: Record<string, string>;
}

/** Standard async shape used by every screen, so loading and error
 *  states are handled identically everywhere. */
export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: ApiError | null;
}
