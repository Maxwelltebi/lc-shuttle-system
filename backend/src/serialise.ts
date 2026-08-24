import type {
  Bus,
  BusStatus,
  Driver,
  QueueEntry,
  RideRequest,
  RideSchedule,
  Stop,
  StopDemand,
  Student,
  WaitingCheckIn,
} from '../../shared/types';

/**
 * Mongoose document → API response.
 *
 * Every function here declares the shared type as its return type, so
 * TypeScript fails the build if the backend ever produces a shape the
 * frontend does not expect. This file is the enforcement point for
 * "no data mismatches" — nothing else in the backend writes a response
 * body by hand.
 *
 * Two conversions happen consistently throughout:
 *   ObjectId → string     (the contract says `id: string`)
 *   Date     → ISO string (JSON has no date type)
 */

/** Anything Mongoose hands back, before we have narrowed it. */
type Doc = Record<string, any>;

const id = (value: unknown): string => String(value);
const idOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const iso = (value: Date | null | undefined): string =>
  (value ?? new Date()).toISOString();
const isoOrNull = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

/** A bus is offline if its last ping is older than this (FR1.5). */
export const STALE_PING_MS = 2 * 60 * 1000;

/** A check-in expires this long after creation (FR2.6). */
export const CHECKIN_TTL_MS = 90 * 60 * 1000;

/** A claim with no schedule is released after this (FR3.8). */
export const CLAIM_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export function toStop(doc: Doc): Stop {
  return {
    id: id(doc._id),
    name: doc.name,
    address: doc.address,
    lat: doc.lat,
    lng: doc.lng,
    sequence: doc.sequence,
  };
}

export function toStudent(doc: Doc): Student {
  return {
    id: id(doc._id),
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    homeStopId: idOrNull(doc.homeStop),
  };
}

export function toDriver(doc: Doc): Driver {
  return {
    id: id(doc._id),
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    busId: idOrNull(doc.bus),
    approved: Boolean(doc.approved),
  };
}

/**
 * Bus status is derived, never stored.
 *
 * Storing it would mean a bus stays "live" forever once its driver's
 * phone dies — the whole point of FR1.5 is that staleness is decided at
 * read time, against the clock, not written down at ping time.
 */
export function busStatus(doc: Doc): BusStatus {
  if (!doc.onDuty) return 'off_duty';
  if (!doc.lastPingAt) return 'offline';
  const age = Date.now() - new Date(doc.lastPingAt).getTime();
  return age > STALE_PING_MS ? 'offline' : 'live';
}

export function toBus(doc: Doc, scheduleOffsetMinutes: number | null): Bus {
  const status = busStatus(doc);
  const hasPosition =
    doc.lat !== null && doc.lng !== null && doc.lastPingAt !== null;

  return {
    id: id(doc._id),
    label: doc.label,
    status,
    onDuty: Boolean(doc.onDuty),
    /* Off duty means no position at all, not a stale one. A student
       must never see a pin for a bus that is not running. */
    position:
      doc.onDuty && hasPosition
        ? {
            lat: doc.lat,
            lng: doc.lng,
            lastPingAt: iso(doc.lastPingAt),
            accuracyMeters: doc.accuracyMeters ?? null,
          }
        : null,
    nextStopId: doc.onDuty ? idOrNull(doc.nextStop) : null,
    scheduleOffsetMinutes: doc.onDuty ? scheduleOffsetMinutes : null,
  };
}

export function toCheckIn(doc: Doc): WaitingCheckIn {
  const createdAt = new Date(doc.createdAt);
  return {
    id: id(doc._id),
    studentId: id(doc.student),
    stopId: id(doc.stop),
    status: doc.status,
    createdAt: createdAt.toISOString(),
    /* Server-supplied so the UI countdown can never disagree with the
       server's read-time expiry rule. */
    expiresAt: new Date(createdAt.getTime() + CHECKIN_TTL_MS).toISOString(),
  };
}

export function toStopDemand(
  stopId: string,
  waitingCount: number,
  oldestCheckInAt: Date | null,
): StopDemand {
  return {
    stopId,
    waitingCount,
    oldestCheckInAt: isoOrNull(oldestCheckInAt),
  };
}

export function toSchedule(doc: Doc): RideSchedule {
  return {
    id: id(doc._id),
    rideRequestId: id(doc.rideRequest),
    driverId: id(doc.driver),
    tripAt: iso(doc.tripAt),
    destination: doc.destination,
    pickupLabel: doc.pickupLabel,
    sentAt: isoOrNull(doc.sentAt),
    emailStatus: doc.emailStatus,
  };
}

export function toRideRequest(doc: Doc, schedule: Doc | null = null): RideRequest {
  return {
    id: id(doc._id),
    reference: doc.reference,
    studentId: id(doc.student),
    destination: doc.destination,
    pickupStopId: idOrNull(doc.pickupStop),
    pickupLabel: doc.pickupLabel,
    requestedAt: iso(doc.requestedAt),
    status: doc.status,
    claimedByDriverId: idOrNull(doc.claimedBy),
    claimedAt: isoOrNull(doc.claimedAt),
    createdAt: iso(doc.createdAt),
    schedule: schedule ? toSchedule(schedule) : null,
  };
}

/**
 * Queue rows carry the student's name so the driver's list does not need
 * a second round trip per request.
 */
export function toQueueEntry(doc: Doc, student: Doc): QueueEntry {
  return {
    ...toRideRequest(doc),
    studentName: `${student.firstName} ${student.lastName}`,
  };
}
