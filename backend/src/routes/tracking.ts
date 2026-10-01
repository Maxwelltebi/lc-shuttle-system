import { Router } from 'express';
import type { Bus as BusType, StopArrival } from '../../../shared/types';
import { Bus, Stop } from '../models/index.js';
import {
  fail,
  requireApprovedDriver,
  requireAuth,
  requireRole,
} from '../middleware/auth.js';
import { STALE_PING_MS, toBus } from '../serialise.js';
import {
  computeArrivals,
  scheduleOffsetMinutes,
  serviceStatus,
  type StopTiming,
} from '../services/schedule.js';
import { isOutOfOrder, validatePing } from '../services/position.js';

export const trackingRouter = Router();

async function stopTimings(): Promise<StopTiming[]> {
  const stops = await Stop.find().sort({ sequence: 1 }).lean();
  return stops.map((stop) => ({
    id: String(stop._id),
    sequence: stop.sequence as number,
    lat: stop.lat as number,
    lng: stop.lng as number,
    offsetMinutes: stop.offsetMinutes as number,
  }));
}

/** Both buses, with derived status and schedule offset. */
trackingRouter.get('/buses', requireAuth, async (_req, res) => {
  const [buses, timings] = await Promise.all([Bus.find().lean(), stopTimings()]);

  const payload: BusType[] = buses.map((bus) => {
    const nextStop = bus.nextStop
      ? timings.find((stop) => stop.id === String(bus.nextStop))
      : null;

    /* lean() types these as possibly undefined, and an undefined
       coordinate must never reach the ETA maths. */
    const lat = typeof bus.lat === 'number' ? bus.lat : null;
    const lng = typeof bus.lng === 'number' ? bus.lng : null;

    const offset =
      bus.onDuty && lat !== null && lng !== null && nextStop
        ? scheduleOffsetMinutes({ lat, lng }, nextStop)
        : null;

    return toBus(bus, offset);
  });

  return res.json(payload);
});

/** Whether anything is running right now (FR1.7). */
trackingRouter.get('/service-status', (_req, res) => {
  return res.json(serviceStatus());
});

/** Arrival estimates for one bus, in loop order (FR1.4, FR1.6). */
trackingRouter.get('/buses/:id/arrivals', requireAuth, async (req, res) => {
  const bus = await Bus.findById(req.params.id).lean();
  if (!bus) return fail(res, 404, 'not_found', 'No such bus.');

  const timings = await stopTimings();
  // Same freshness rule as map status: stale GPS ⇒ timetable only.
  const pingAge = bus.lastPingAt ? Date.now() - new Date(bus.lastPingAt as unknown as string).getTime() : Infinity;
  const fresh = bus.onDuty && pingAge <= STALE_PING_MS;
  const inService = serviceStatus().state === 'in_service';
  const position =
    fresh && inService && bus.lat !== null && bus.lng !== null
      ? { lat: bus.lat as number, lng: bus.lng as number }
      : null;

  const arrivals: StopArrival[] = computeArrivals(
    timings,
    position,
    fresh && inService && bus.nextStop ? String(bus.nextStop) : null,
  ).map((arrival) => ({ ...arrival, busId: String(bus._id) }));

  return res.json(arrivals);
});

/**
 * Go on or off duty.
 *
 * Going off duty clears the last position rather than leaving it behind:
 * a stale pin sitting in a parking lot is worse than no pin, because it
 * sends a student outside to wait for a bus that is not coming.
 */
trackingRouter.post(
  '/buses/:id/duty',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return fail(res, 404, 'not_found', 'No such bus.');

    if (String(bus.get('driver')) !== String(req.account._id)) {
      return fail(res, 403, 'forbidden', 'That is not your bus.');
    }

    const onDuty = Boolean(req.body?.onDuty);
    bus.set({ onDuty });
    if (!onDuty) {
      bus.set({
        lat: null,
        lng: null,
        accuracyMeters: null,
        lastPingAt: null,
        measuredAt: null,
        lastSeq: null,
        nextStop: null,
      });
    }
    await bus.save();

    return res.json(toBus(bus.toObject(), null));
  },
);

/** The destination students read as "where it's going" (FR1.3). */
trackingRouter.post(
  '/buses/:id/next-stop',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return fail(res, 404, 'not_found', 'No such bus.');

    if (String(bus.get('driver')) !== String(req.account._id)) {
      return fail(res, 403, 'forbidden', 'That is not your bus.');
    }

    const stop = await Stop.findById(req.body?.stopId).lean();
    if (!stop) return fail(res, 422, 'validation_failed', 'No such stop.');

    bus.set({ nextStop: stop._id });
    await bus.save();

    const timings = await stopTimings();
    const timing = timings.find((entry) => entry.id === String(stop._id))!;
    const lat = bus.get('lat');
    const lng = bus.get('lng');
    const offset =
      typeof lat === 'number' && typeof lng === 'number'
        ? scheduleOffsetMinutes({ lat, lng }, timing)
        : null;

    return res.json(toBus(bus.toObject(), offset));
  },
);

/**
 * Position ping from the driver's device, every 10 seconds (FR1.1).
 *
 * HTTP fallback path — socket primary uses the same validation via
 * applyPositionUpdate(). Rejected while off duty; stale or out-of-order
 * measurements rejected so markers cannot move backward.
 */
trackingRouter.post(
  '/buses/:id/ping',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return fail(res, 404, 'not_found', 'No such bus.');

    if (String(bus.get('driver')) !== String(req.account._id)) {
      return fail(res, 403, 'forbidden', 'That is not your bus.');
    }

    if (!bus.get('onDuty')) {
      return fail(res, 403, 'forbidden', 'You are off duty.');
    }

    const result = await applyPositionUpdate(String(bus._id), String(req.account._id), req.body ?? {});
    if (!result.ok) {
      const status = result.code === 'stale' ? 409 : 422;
      return fail(res, status, 'validation_failed', result.message);
    }

    return res.json(null);
  },
);

/** Shared by HTTP ping and socket updates. Returns the saved bus. */
export async function applyPositionUpdate(
  busId: string,
  driverId: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; message: string; code: 'invalid' | 'stale' }> {
  const bus = await Bus.findById(busId);
  if (!bus) return { ok: false, message: 'No such bus.', code: 'invalid' };
  if (String(bus.get('driver')) !== String(driverId)) {
    return { ok: false, message: 'That is not your bus.', code: 'invalid' };
  }
  if (!bus.get('onDuty')) {
    return { ok: false, message: 'You are off duty.', code: 'invalid' };
  }
  const parsed = validatePing((body ?? {}) as never);
  if (!parsed.ok) return { ok: false, message: parsed.message, code: 'invalid' };
  const lastSeq = bus.get('lastSeq') as number | null;
  const lastMeasured = bus.get('measuredAt') as Date | null;
  if (isOutOfOrder(lastSeq, lastMeasured, parsed.value)) {
    return { ok: false, message: 'Older update ignored.', code: 'stale' };
  }
  bus.set({
    lat: parsed.value.lat,
    lng: parsed.value.lng,
    accuracyMeters: parsed.value.accuracyMeters,
    measuredAt: parsed.value.measuredAt,
    lastSeq: parsed.value.seq,
    lastPingAt: new Date(),
  });
  await bus.save();
  return { ok: true };
}
