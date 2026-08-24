import type { ServiceStatus, StopArrival } from '../../../shared/types';

/**
 * The published timetable, and everything derived from it.
 *
 * Service hours are computed here rather than in the browser because a
 * phone with a wrong clock would tell a student "next departure 1:15 PM"
 * twenty minutes late, and they would miss the bus.
 *
 * Source: the Livingstone College Academic Shuttle flyer.
 */

/** Salisbury, NC. Fixed so a server in another region still tells the
 *  truth about when the shuttle runs. */
const TIMEZONE = 'America/New_York';

/** Departures from Horseshoe Gate, in minutes after midnight. */
const DEPARTURES = [
  7 * 60 + 15,
  8 * 60 + 15,
  9 * 60 + 15,
  10 * 60 + 15,
  11 * 60 + 15,
  13 * 60 + 15,
  14 * 60 + 15,
  15 * 60 + 15,
  16 * 60 + 15,
  17 * 60 + 15,
  18 * 60 + 15,
  19 * 60 + 15,
];

const LUNCH_START = 12 * 60 + 15;
const LUNCH_END = 13 * 60 + 15;
/** The 7:15 PM loop finishes at 8:10 PM. */
const SERVICE_END = 20 * 60 + 10;
const FIRST_DEPARTURE = DEPARTURES[0];

/** Minutes after midnight, in Salisbury's timezone. */
export function localMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** 795 → "1:15 PM" */
export function formatClock(minutesAfterMidnight: number): string {
  const total = ((minutesAfterMidnight % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** The departure the shuttle is currently running, or null. */
export function currentDeparture(now = new Date()): number | null {
  const minutes = localMinutes(now);
  let current: number | null = null;
  for (const departure of DEPARTURES) {
    if (departure <= minutes) current = departure;
  }
  return current;
}

function nextDeparture(minutes: number): number | null {
  return DEPARTURES.find((departure) => departure > minutes) ?? null;
}

/**
 * Whether anything is on the road right now (FR1.7).
 *
 * The message is rendered verbatim by the UI, so it is written as a
 * sentence a student can act on, not a status code.
 */
export function serviceStatus(now = new Date()): ServiceStatus {
  const minutes = localMinutes(now);
  const upcoming = nextDeparture(minutes);

  if (minutes < FIRST_DEPARTURE) {
    return {
      state: 'closed',
      nextDepartureClock: formatClock(FIRST_DEPARTURE),
      message: `Service starts at ${formatClock(FIRST_DEPARTURE)}. Nothing on the road right now.`,
    };
  }

  if (minutes >= SERVICE_END) {
    return {
      state: 'closed',
      nextDepartureClock: formatClock(FIRST_DEPARTURE),
      message: `Service has ended for today. The first loop tomorrow leaves at ${formatClock(FIRST_DEPARTURE)}.`,
    };
  }

  if (minutes >= LUNCH_START && minutes < LUNCH_END) {
    return {
      state: 'lunch_break',
      nextDepartureClock: formatClock(LUNCH_END),
      message: 'Driver lunch break. Nothing on the road right now.',
    };
  }

  return {
    state: 'in_service',
    nextDepartureClock: upcoming ? formatClock(upcoming) : null,
    message: 'Buses are running the hourly loop.',
  };
}

/* ------------------------------------------------------------------ */
/* ETAs                                                                */
/* ------------------------------------------------------------------ */

export interface StopTiming {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  /** Minutes after departure that the loop reaches this stop. */
  offsetMinutes: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** Straight-line distance understates road distance; the README settles
 *  on 1.4× at 25 mph as good enough for v1. */
const ROAD_FACTOR = 1.4;
const AVERAGE_MPH = 25;

function minutesToReach(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const miles = haversineMiles(from, to) * ROAD_FACTOR;
  return Math.max(1, Math.round((miles / AVERAGE_MPH) * 60));
}

/**
 * How many minutes behind the timetable a bus is running.
 *
 * Positive means late. Compares when the bus will actually reach its
 * declared next stop against when the timetable says it should have.
 */
export function scheduleOffsetMinutes(
  bus: { lat: number; lng: number },
  nextStop: StopTiming,
  now = new Date(),
): number | null {
  const departure = currentDeparture(now);
  if (departure === null) return null;

  const scheduledArrival = departure + nextStop.offsetMinutes;
  const projectedArrival = localMinutes(now) + minutesToReach(bus, nextStop);
  return projectedArrival - scheduledArrival;
}

/**
 * Arrival estimates for every stop, for one bus (FR1.4, FR1.6).
 *
 * Follows the loop rather than straight-line distance: after the last
 * stop the bus wraps to the first, so a stop earlier in the sequence
 * than the bus's next stop is reached on the *following* pass, a full
 * loop later. Sorting by distance would put those stops minutes away
 * when they are actually most of an hour away.
 */
export function computeArrivals(
  stops: StopTiming[],
  bus: { lat: number; lng: number } | null,
  nextStopId: string | null,
  now = new Date(),
): StopArrival[] {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const departure = currentDeparture(now);
  const loopMinutes = ordered.length
    ? ordered[ordered.length - 1].offsetMinutes + 7
    : 60;

  const nextIndex = nextStopId
    ? ordered.findIndex((stop) => stop.id === nextStopId)
    : -1;

  const nextStop = nextIndex >= 0 ? ordered[nextIndex] : null;
  const minutesToNext = bus && nextStop ? minutesToReach(bus, nextStop) : null;

  return ordered.map((stop) => {
    const scheduledClock =
      departure === null ? null : formatClock(departure + stop.offsetMinutes);

    /* No live estimate without a position and a declared next stop —
       fall back to the printed timetable, which is exactly what an
       offline bus should show. */
    if (!bus || !nextStop || minutesToNext === null) {
      return {
        stopId: stop.id,
        busId: '',
        etaMinutes: null,
        etaClock: null,
        scheduledClock,
      };
    }

    const index = ordered.indexOf(stop);
    /* Steps around the loop from the next stop to this one. */
    const stepsAhead = (index - nextIndex + ordered.length) % ordered.length;
    const extra =
      stepsAhead === 0
        ? 0
        : stop.offsetMinutes >= nextStop.offsetMinutes
          ? stop.offsetMinutes - nextStop.offsetMinutes
          : loopMinutes - nextStop.offsetMinutes + stop.offsetMinutes;

    const etaMinutes = minutesToNext + extra;

    return {
      stopId: stop.id,
      busId: '',
      etaMinutes,
      etaClock: formatClock(localMinutes(now) + etaMinutes),
      scheduledClock,
    };
  });
}
