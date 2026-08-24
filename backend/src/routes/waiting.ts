import { Router } from 'express';
import type { StopDemand, WaitingCheckIn as CheckInType } from '../../../shared/types';
import { Stop, WaitingCheckIn } from '../models/index.js';
import {
  fail,
  requireApprovedDriver,
  requireAuth,
  requireRole,
} from '../middleware/auth.js';
import { CHECKIN_TTL_MS, toCheckIn, toStopDemand } from '../serialise.js';

export const waitingRouter = Router();

/**
 * Expiry is applied at read time (FR2.6).
 *
 * No cron job: a check-in older than 90 minutes simply stops matching
 * this filter. One rule, evaluated the same way by every query, so the
 * board and the student's own view can never disagree about whether a
 * check-in is still live.
 */
function activeFilter() {
  return {
    status: 'waiting' as const,
    createdAt: { $gte: new Date(Date.now() - CHECKIN_TTL_MS) },
  };
}

/** The signed-in student's active check-in, or null. */
waitingRouter.get('/me', requireAuth, requireRole('student'), async (req, res) => {
  const checkIn = await WaitingCheckIn.findOne({
    student: req.account._id,
    ...activeFilter(),
  }).lean();

  return res.json(checkIn ? toCheckIn(checkIn) : null);
});

/**
 * Check in at a stop (FR2.1, FR2.2).
 *
 * Any existing check-in is withdrawn in the same request rather than the
 * client deleting first — two round trips could leave a student counted
 * at two stops if the second one failed.
 */
waitingRouter.post('/', requireAuth, requireRole('student'), async (req, res) => {
  const stop = await Stop.findById(req.body?.stopId).lean();
  if (!stop) return fail(res, 422, 'validation_failed', 'No such stop.');

  await WaitingCheckIn.updateMany(
    { student: req.account._id, status: 'waiting' },
    { status: 'withdrawn' },
  );

  const created = await WaitingCheckIn.create({
    student: req.account._id,
    stop: stop._id,
    status: 'waiting',
  });

  const payload: CheckInType = toCheckIn(created.toObject());
  return res.status(201).json(payload);
});

/** Student withdraws their own check-in (FR2.3). */
waitingRouter.delete(
  '/:id',
  requireAuth,
  requireRole('student'),
  async (req, res) => {
    const checkIn = await WaitingCheckIn.findById(req.params.id);
    if (!checkIn) return fail(res, 404, 'not_found', 'No such check-in.');

    /* A student may only withdraw their own. */
    if (String(checkIn.get('student')) !== String(req.account._id)) {
      return fail(res, 403, 'forbidden', 'That is not your check-in.');
    }

    checkIn.set({ status: 'withdrawn' });
    await checkIn.save();
    return res.json(null);
  },
);

/**
 * The driver's board (FR2.4).
 *
 * Returns a row for every stop, including the empty ones, so the board
 * keeps its shape and the driver reads the same nine cards in the same
 * order every time.
 */
waitingRouter.get(
  '/demand',
  requireAuth,
  requireRole('driver'),
  async (_req, res) => {
    const [stops, active] = await Promise.all([
      Stop.find().sort({ sequence: 1 }).lean(),
      WaitingCheckIn.find(activeFilter()).sort({ createdAt: 1 }).lean(),
    ]);

    const byStop = new Map<string, { count: number; oldest: Date }>();
    for (const checkIn of active) {
      const key = String(checkIn.stop);
      const existing = byStop.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byStop.set(key, {
          count: 1,
          oldest: new Date((checkIn as { createdAt: Date }).createdAt),
        });
      }
    }

    const payload: StopDemand[] = stops.map((stop) => {
      const row = byStop.get(String(stop._id));
      return toStopDemand(String(stop._id), row?.count ?? 0, row?.oldest ?? null);
    });

    return res.json(payload);
  },
);

/** Bulk-clear every active check-in at one stop, in one tap (FR2.5). */
waitingRouter.post(
  '/demand/:stopId/clear',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const stop = await Stop.findById(req.params.stopId).lean();
    if (!stop) return fail(res, 404, 'not_found', 'No such stop.');

    await WaitingCheckIn.updateMany(
      { stop: stop._id, ...activeFilter() },
      {
        status: 'picked_up',
        clearedBy: req.account._id,
        clearedAt: new Date(),
      },
    );

    return res.json(toStopDemand(String(stop._id), 0, null));
  },
);
