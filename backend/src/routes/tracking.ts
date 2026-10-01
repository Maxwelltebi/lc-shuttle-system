import { Router } from 'express';
import { Bus, Driver, Stop } from '../models/index.js';
import { fail, requireApprovedDriver, requireAuth, requireRole } from '../middleware/auth.js';
import { toBus } from '../serialise.js';
import { serviceStatus } from '../services/schedule.js';
import { validatePing } from '../services/position.js';
import { publishBusChange, readFleet } from '../services/fleet.js';

export const trackingRouter = Router();
trackingRouter.get('/buses', requireAuth, async (_req, res) => res.json((await readFleet()).map(row => row.bus)));
trackingRouter.get('/service-status', (_req, res) => res.json(serviceStatus()));
trackingRouter.get('/buses/:id/arrivals', requireAuth, async (req, res) => {
  const row = (await readFleet()).find(row => row.bus.id === req.params.id);
  return row ? res.json(row.arrivals) : fail(res, 404, 'not_found', 'No such bus.');
});

trackingRouter.post('/buses/:id/duty', requireAuth, requireRole('driver'), requireApprovedDriver, async (req, res) => {
  if (typeof req.body?.onDuty !== 'boolean') return fail(res, 422, 'validation_failed', 'onDuty must be a boolean.');
  const onDuty = req.body.onDuty;
  const bus = await Bus.findOneAndUpdate(
    { _id: req.params.id, driver: req.account._id },
    { $set: { onDuty, ...(!onDuty ? { lat: null, lng: null, accuracyMeters: null, lastPingAt: null, nextStop: null } : {}) }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  );
  if (!bus) return fail(res, 403, 'forbidden', 'That is not your bus.');
  // Keep measuredAt as a high-water mark across duty sessions.
  publishBusChange(String(bus._id));
  return res.json(toBus(bus.toObject(), null));
});
trackingRouter.post('/buses/:id/next-stop', requireAuth, requireRole('driver'), requireApprovedDriver, async (req, res) => {
  const stop = await Stop.findById(req.body?.stopId).lean();
  if (!stop) return fail(res, 422, 'validation_failed', 'No such stop.');
  const bus = await Bus.findOneAndUpdate(
    { _id: req.params.id, driver: req.account._id, onDuty: true },
    { $set: { nextStop: stop._id }, $inc: { revision: 1 } }, { returnDocument: 'after' },
  );
  if (!bus) return fail(res, 403, 'forbidden', 'Bus unavailable or off duty.');
  publishBusChange(String(bus._id));
  return res.json(toBus(bus.toObject(), null));
});
trackingRouter.post('/buses/:id/ping', requireAuth, requireRole('driver'), requireApprovedDriver, async (req, res) => {
  const owned = await Bus.findOne({ _id: req.params.id, driver: req.account._id, onDuty: true }).lean();
  if (!owned) return fail(res, 403, 'forbidden', 'Bus unavailable or off duty.');
  const result = await applyPositionUpdate(String(req.params.id), String(req.account._id), req.body);
  if (!result.ok) return fail(res, result.code === 'stale' ? 409 : 422, 'validation_failed', result.message);
  return res.json(null);
});

export async function applyPositionUpdate(busId: string, driverId: string, body: unknown): Promise<
  { ok: true } | { ok: false; message: string; code: 'invalid' | 'stale' }
> {
  if (!await Driver.exists({ _id: driverId, approved: true })) return { ok: false, message: 'Driver is not approved.', code: 'invalid' };
  const parsed = validatePing((body ?? {}) as never);
  if (!parsed.ok) return { ok: false, message: parsed.message, code: 'invalid' };
  const p = parsed.value;
  const bus = await Bus.findOneAndUpdate(
    { _id: busId, driver: driverId, onDuty: true, $or: [{ measuredAt: null }, { measuredAt: { $lt: p.measuredAt } }] },
    { $set: { lat: p.lat, lng: p.lng, accuracyMeters: p.accuracyMeters, measuredAt: p.measuredAt, lastSeq: p.seq, lastPingAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  );
  if (bus) { publishBusChange(busId); return { ok: true }; }
  // An identical retry acknowledges the previous write without refreshing its age.
  const duplicate = await Bus.exists({ _id: busId, driver: driverId, onDuty: true, measuredAt: p.measuredAt, lat: p.lat, lng: p.lng, accuracyMeters: p.accuracyMeters });
  if (duplicate) return { ok: true };
  return { ok: false, message: 'Bus unavailable or older/conflicting measurement ignored.', code: 'stale' };
}
