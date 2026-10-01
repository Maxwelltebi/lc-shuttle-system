import { Router } from 'express';
import mongoose from 'mongoose';
import type { QueueEntry, RideRequest as RideRequestType } from '../../../shared/types';
import { Counter, EmailOutbox, RideRequest, RideSchedule, Stop, Student } from '../models/index.js';
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

export const requestsRouter = Router();

/** Human-facing reference shown on the student's list: "RR-1042". Atomic counter. */
async function nextReference(): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { name: 'rideRequest' },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return `RR-${counter!.value}`;
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
 * Transactional: valid owned non-expired claim required; exactly one
 * schedule per request (unique index + idempotent return); schedule +
 * request update + email outbox job committed together. Trip creation
 * never fails because the mail provider is down — the worker retries.
 */
requestsRouter.post(
  '/:id/schedule',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (req, res) => {
    const tripAt = req.body?.tripAt ? new Date(req.body.tripAt) : null;
    if (!tripAt || Number.isNaN(tripAt.getTime())) {
      return fail(res, 422, 'validation_failed', 'Pick a date and time.', {
        tripAt: 'Pick a date and time.',
      });
    }

    const session = await mongoose.startSession();
    try {
      let scheduleDoc: unknown = null;
      await session.withTransaction(async () => {
        const request = await RideRequest.findById(req.params.id).session(session);
        if (!request) {
          const err = new Error('No such request.') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        // Enforce expiry during mutation: past requestedAt ⇒ expired.
        if ((request.get('requestedAt') as Date).getTime() < Date.now() && request.get('status') === 'open') {
          request.set({ status: 'expired' });
          await request.save({ session });
          const err = new Error('That request has expired.') as Error & { statusCode?: number };
          err.statusCode = 410;
          throw err;
        }
        // Stuck-claim release during mutation.
        const claimedAt = request.get('claimedAt') as Date | null;
        if (
          request.get('status') === 'claimed' &&
          claimedAt &&
          claimedAt.getTime() < Date.now() - CLAIM_TIMEOUT_MS
        ) {
          request.set({ status: 'open', claimedBy: null, claimedAt: null });
          await request.save({ session });
        }
        if (String(request.get('claimedBy')) !== String(req.account._id) || request.get('status') !== 'claimed') {
          const err = new Error('You have not claimed that request.') as Error & { statusCode?: number };
          err.statusCode = 403;
          throw err;
        }
        // Idempotent: repeat scheduling returns the existing schedule.
        const existing = await RideSchedule.findOne({ rideRequest: request._id }).session(session);
        if (existing) {
          scheduleDoc = existing;
          return;
        }
        const student = await Student.findById(request.get('student')).session(session).lean();
        if (!student) {
          const err = new Error('That student no longer exists.') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        const [schedule] = await RideSchedule.create(
          [
            {
              rideRequest: request._id,
              driver: req.account._id,
              tripAt,
              destination: request.get('destination'),
              pickupLabel: request.get('pickupLabel'),
              emailStatus: 'pending',
            },
          ],
          { session },
        );
        request.set({ status: 'scheduled' });
        await request.save({ session });
        await EmailOutbox.create(
          [
            {
              rideRequest: request._id,
              rideSchedule: schedule._id,
              to: (student.email as string) ?? '',
              status: 'pending',
              attempts: 0,
              nextRunAt: new Date(),
            },
          ],
          { session },
        );
        scheduleDoc = schedule;
      });
      const plain = (scheduleDoc as { toObject(): unknown }).toObject();
      return res.status(201).json(toSchedule(plain as never));
    } catch (error) {
      if (error instanceof Error && (error as Error & { statusCode?: number }).statusCode) {
        const code = (error as Error & { statusCode?: number }).statusCode!;
        if (code === 404) return fail(res, 404, 'not_found', error.message);
        if (code === 410) return fail(res, 410, 'validation_failed', error.message);
        return fail(res, 403, 'forbidden', error.message);
      }
      // Duplicate schedule race → return existing (idempotent).
      if (error instanceof Error && /duplicate key/i.test(error.message)) {
        const existing = await RideSchedule.findOne({ rideRequest: req.params.id }).lean();
        if (existing) return res.status(200).json(toSchedule(existing));
      }
      // Standalone Mongo fallback: non-transactional idempotent path.
      if (error instanceof Error && /transaction|replica/i.test(error.message)) {
        const request = await RideRequest.findById(req.params.id);
        if (!request) return fail(res, 404, 'not_found', 'No such request.');
        if (String(request.get('claimedBy')) !== String(req.account._id)) {
          return fail(res, 403, 'forbidden', 'You have not claimed that request.');
        }
        const existing = await RideRequest.db.collection('rideschedules').findOne({ rideRequest: request._id });
        if (existing) return res.status(200).json(toSchedule(existing));
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
        await EmailOutbox.create({
          rideRequest: request._id,
          rideSchedule: schedule._id,
          to: student.email as string,
          status: 'pending',
        });
        return res.status(201).json(toSchedule(schedule.toObject()));
      }
      throw error;
    } finally {
      await session.endSession();
    }
  },
);

/**
 * Retry a failed schedule email — enqueues a durable outbox job.
 *
 * Mounted separately at /api/schedules so the path matches what the
 * frontend already calls — see INTEGRATION.md.
 */
export const schedulesRouter = Router();

schedulesRouter.get(
  '/failed',
  requireAuth,
  requireRole('driver'),
  requireApprovedDriver,
  async (_req, res) => {
    const jobs = await EmailOutbox.find({ status: { $in: ['pending', 'failed'] } })
      .sort({ nextRunAt: 1 })
      .limit(50)
      .lean();
    return res.json(
      jobs.map((j) => ({
        id: String(j._id),
        rideRequestId: String(j.rideRequest),
        scheduleId: String(j.rideSchedule),
        to: j.to,
        status: j.status,
        attempts: j.attempts,
        nextRunAt: (j.nextRunAt as Date).toISOString(),
        lastError: (j.lastError as string | null) ?? null,
        sentAt: j.sentAt ? (j.sentAt as Date).toISOString() : null,
      })),
    );
  },
);

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

    // Deduplicate: reuse the existing job if still queued.
    const existing = await EmailOutbox.findOne({ rideSchedule: schedule._id });
    if (existing && ['pending', 'sending'].includes(existing.get('status') as string)) {
      return res.json(toSchedule(schedule.toObject()));
    }
    await EmailOutbox.findOneAndUpdate(
      { rideSchedule: schedule._id },
      {
        rideRequest: schedule.get('rideRequest'),
        rideSchedule: schedule._id,
        to: student.email as string,
        status: 'pending',
        nextRunAt: new Date(),
        lastError: null,
      },
      { upsert: true },
    );
    schedule.set({ emailStatus: 'pending' });
    await schedule.save();

    return res.json(toSchedule(schedule.toObject()));
  },
);
