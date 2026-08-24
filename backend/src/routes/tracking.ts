import { Router } from 'express';
import type { Bus as BusType, StopArrival } from '../../../shared/types';
import { Bus, Stop } from '../models/index.js';
import {
  fail,
  requireApprovedDriver,
  requireAuth,
  requireRole,
} from '../middleware/auth.js';
import { toBus } from '../serialise.js';
import {
  computeArrivals,
  scheduleOffsetMinutes,
  serviceStatus,
  type StopTiming,
} from '../services/schedule.js';

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
  const position =
    bus.onDuty && bus.lat !== null && bus.lng !== null
      ? { lat: bus.lat as number, lng: bus.lng as number }
      : null;

  const arrivals: StopArrival[] = computeArrivals(
    timings,
    position,
    bus.nextStop ? String(bus.nextStop) : null,
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
 * Rejected while off duty: a bus that is not running must not appear on
 * a student's map, whatever the device keeps sending.
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

    const { lat, lng, accuracyMeters } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return fail(res, 422, 'validation_failed', 'A position is required.');
    }

    bus.set({
      lat,
      lng,
      accuracyMeters: typeof accuracyMeters === 'number' ? accuracyMeters : null,
      lastPingAt: new Date(),
    });
    await bus.save();

    return res.json(null);
  },
);
