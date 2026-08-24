import { Router } from 'express';
import type { QueueEntry, RideRequest as RideRequestType } from '../../../shared/types';
import { RideRequest, RideSchedule, Stop, Student } from '../models/index.js';
import {
  fail,
  requireApprovedDriver,
  requireAuth,
  requireRole,
} from '../middleware/auth.js';
import {
  CLAIM_TIMEOUT_MS,
  toQueueEntry,
  toRideRequest,
  toSchedule,
} from '../serialise.js';
import { sendScheduleEmail } from '../services/email.js';

export const requestsRouter = Router();

/** Human-facing reference shown on the student's list: "RR-1042". */
async function nextReference(): Promise<string> {
  const count = await RideRequest.estimatedDocumentCount();
  return `RR-${1000 + count + 1}`;
}

/**
 * Release claims that never turned into a schedule (FR3.8).
 *
 * Run before any queue read rather than on a timer: it is one indexed
 * update, and it guarantees a driver never sees a stale queue. Without
 * it, a driver who claims a trip and forgets locks it away from the
 * other driver forever.
 */
async function releaseStuckClaims() {
  await RideRequest.updateMany(
    {
      status: 'claimed',
      claimedAt: { $lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) },
    },
    { status: 'open', claimedBy: null, claimedAt: null },
  );
}

/**
 * Expire requests whose time has passed with nobody claiming them
 * (FR3.9). Silent by design — no reassignment, no notification. The
 * student finds out on their own list, which is why that screen exists.
 */
async function expirePastRequests() {
  await RideRequest.updateMany(
    { status: 'open', requestedAt: { $lt: new Date() } },
    { status: 'expired' },
  );
}

/** The student's own requests, newest first. */
requestsRouter.get(
  '/mine',
  requireAuth,
  requireRole('student'),
  async (req, res) => {
    await expirePastRequests();

    const requests = await RideRequest.find({ student: req.account._id })
      .sort({ createdAt: -1 })
      .lean();

    const schedules = await RideSchedule.find({
      rideRequest: { $in: requests.map((request) => request._id) },
    }).lean();

    const byRequest = new Map(
      schedules.map((schedule) => [String(schedule.rideRequest), schedule]),
    );

    const payload: RideRequestType[] = requests.map((request) =>
      toRideRequest(request, byRequest.get(String(request._id)) ?? null),
    );

    return res.json(payload);
  },
);

/** Submit an off-route request (FR3.1). */
requestsRouter.post('/', requireAuth, requireRole('student'), async (req, res) => {
  const { destination, pickupStopId, requestedAt } = req.body as {
    destination?: string;
    pickupStopId?: string | null;
    requestedAt?: string;
  };

  const fields: Record<string, string> = {};
  if (!destination?.trim()) fields.destination = 'Where are you going?';
  if (!pickupStopId) fields.pickupStopId = 'Pick a pickup point.';

  const when = requestedAt ? new Date(requestedAt) : null;
  if (!when || Number.isNaN(when.getTime())) {
    fields.requestedAt = 'Pick a date and time.';
  } else if (when.getTime() < Date.now()) {
    /* A request in the past would be expired the moment it was created. */
    fields.requestedAt = 'Pick a time in the future.';
  }

  if (Object.keys(fields).length) {
    return fail(res, 422, 'validation_failed', 'Check the form.', fields);
  }

  const stop = await Stop.findById(pickupStopId).lean();
  if (!stop) {
    return fail(res, 422, 'validation_failed', 'Check the form.', {
      pickupStopId: 'No such stop.',
    });
  }

  const created = await RideRequest.create({
    reference: await nextReference(),
    student: req.account._id,
    destination: destination!.trim(),
    pickupStop: stop._id,
    pickupLabel: `${stop.name} — ${stop.address}`,
    requestedAt: when!,
    status: 'open',
  });

  return res.status(201).json(toRideRequest(created.toObject()));
});

/**
 * The shared queue, oldest first (FR3.2).
 *
 * Returns open requests plus anything *this* driver has claimed but not
 * yet scheduled. Without the second half, claiming a request makes it
 * vanish from the screen the driver is standing on: it is gone from the
 * open list (FR3.5, correct) but has nowhere else to appear, so a
 * refresh loses the trip until the 12-hour release hands it back.
 *
 * The other driver still cannot see it — that is what FR3.5 requires.
 */
requestsRouter.get(
  '/queue',
  requireAuth,
  requireRole('driver'),
  async (req, res) => {
    await Promise.all([releaseStuckClaims(), expirePastRequests()]);

    const requests = await RideRequest.find({
      $or: [
        { status: 'open' },
        { status: 'claimed', claimedBy: req.account._id },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

    const students = await Student.find({
      _id: { $in: requests.map((request) => request.student) },
    }).lean();

    const byId = new Map(students.map((student) => [String(student._id), student]));

    const payload: QueueEntry[] = requests
      .map((request) => {
        const student = byId.get(String(request.student));
        return student ? toQueueEntry(request, student) : null;
      })
      .filter((entry): entry is QueueEntry => entry !== null);

    return res.json(payload);
  },
);

/**
 * Claim a request (FR3.3, FR3.4, FR3.5).
 *
 * One conditional update, never read-then-write. The `status: 'open'`
 * guard is the entire concurrency control: if two drivers tap at the
 * same instant, Mongo applies one and the other matches zero documents.
 * The loser is told plainly, because a silent no-op would leave them
 * believing they had the trip and two buses would show up.
 */
requestsRouter.post(
  '/:id/claim',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    await releaseStuckClaims();

    const claimed = await RideRequest.findOneAndUpdate(
      { _id: req.params.id, status: 'open' },
      {
        status: 'claimed',
        claimedBy: req.account._id,
        claimedAt: new Date(),
      },
      { returnDocument: 'after' },
    ).lean();

    if (!claimed) {
      const exists = await RideRequest.findById(req.params.id).lean();
      if (!exists) return fail(res, 404, 'not_found', 'No such request.');

      return fail(
        res,
        409,
        'claim_conflict',
        'The other driver claimed this one first.',
      );
    }

    return res.json(toRideRequest(claimed));
  },
);

/**
 * Submit the schedule and email it (FR3.6, FR3.7).
 *
 * The schedule is saved before the email is attempted, and a send
 * failure does not roll it back — losing the trip because a mail server
 * was down would be worse than a driver having to press Resend.
 */
requestsRouter.post(
  '/:id/schedule',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const request = await RideRequest.findById(req.params.id);
    if (!request) return fail(res, 404, 'not_found', 'No such request.');

    if (String(request.get('claimedBy')) !== String(req.account._id)) {
      return fail(res, 403, 'forbidden', 'You have not claimed that request.');
    }

    const tripAt = req.body?.tripAt ? new Date(req.body.tripAt) : null;
    if (!tripAt || Number.isNaN(tripAt.getTime())) {
      return fail(res, 422, 'validation_failed', 'Pick a date and time.', {
        tripAt: 'Pick a date and time.',
      });
    }

    const student = await Student.findById(request.get('student')).lean();
    if (!student) return fail(res, 404, 'not_found', 'That student no longer exists.');

    const schedule = await RideSchedule.create({
      rideRequest: request._id,
      driver: req.account._id,
      tripAt,
      destination: request.get('destination'),
      pickupLabel: request.get('pickupLabel'),
      emailStatus: 'pending',
    });

    request.set({ status: 'scheduled' });
    await request.save();

    const result = await sendScheduleEmail({
      to: student.email as string,
      studentName: student.firstName as string,
      driverName: `${req.account.firstName} ${req.account.lastName}`,
      destination: request.get('destination'),
      pickupLabel: request.get('pickupLabel'),
      tripAt,
    });

    schedule.set({
      emailStatus: result.ok ? 'sent' : 'failed',
      sentAt: result.ok ? new Date() : null,
      emailError: result.error,
    });
    await schedule.save();

    return res.status(201).json(toSchedule(schedule.toObject()));
  },
);

/**
 * Retry a failed schedule email.
 *
 * Mounted separately at /api/schedules so the path matches what the
 * frontend already calls — see INTEGRATION.md.
 */
export const schedulesRouter = Router();

schedulesRouter.post(
  '/:id/resend',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const schedule = await RideSchedule.findById(req.params.id);
    if (!schedule) return fail(res, 404, 'not_found', 'No such schedule.');

    const request = await RideRequest.findById(schedule.get('rideRequest')).lean();
    const student = request ? await Student.findById(request.student).lean() : null;
    if (!student) return fail(res, 404, 'not_found', 'That student no longer exists.');

    const result = await sendScheduleEmail({
      to: student.email as string,
      studentName: student.firstName as string,
      driverName: `${req.account.firstName} ${req.account.lastName}`,
      destination: schedule.get('destination'),
      pickupLabel: schedule.get('pickupLabel'),
      tripAt: schedule.get('tripAt'),
    });

    schedule.set({
      emailStatus: result.ok ? 'sent' : 'failed',
      sentAt: result.ok ? new Date() : null,
      emailError: result.error,
    });
    await schedule.save();

    return res.json(toSchedule(schedule.toObject()));
  },
);
