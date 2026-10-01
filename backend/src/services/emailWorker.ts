import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Driver, EmailOutbox, RideRequest, RideSchedule, Student } from '../models/index.js';
import { prepareScheduleEmail, sendPreparedEmail } from './email.js';

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
export const RETRY_WINDOW_MS = 23 * 60 * 60_000; // Resend keys expire after 24 hours.

/** One iteration, exported so restart and concurrency behavior can be integration-tested. */
export async function processEmailJob(send = sendPreparedEmail) {
  const now = new Date();
  const token = randomUUID();
  const job = await EmailOutbox.findOneAndUpdate(
    { $or: [
      { status: 'pending', nextRunAt: { $lte: now } },
      { status: 'sending', $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }] },
    ] },
    { $set: { status: 'sending', leaseUntil: new Date(now.getTime() + LEASE_MS), leaseToken: token }, $inc: { attempts: 1 } },
    { sort: { nextRunAt: 1 }, returnDocument: 'after' },
  );
  if (!job) return false;
  const attempts = job.get('attempts') as number;
  let terminal = false;
  let result: Awaited<ReturnType<typeof sendPreparedEmail>>;
  const first = job.get('firstAttemptAt') as Date | null;
  if (attempts > MAX_ATTEMPTS || (first && Date.now() - first.getTime() >= RETRY_WINDOW_MS)) {
    terminal = true;
    result = { ok: false, error: 'Retry limit reached or delivery uncertainty exceeded the safe retry window. Review provider delivery records.', deliveredTo: null };
  } else {
    const schedule = await RideSchedule.findById(job.get('rideSchedule')).lean();
    const request = await RideRequest.findById(job.get('rideRequest')).lean();
    const student = request ? await Student.findById(request.student).lean() : null;
    const driver = schedule ? await Driver.findById(schedule.driver).lean() : null;
    if (!schedule || !request || !student || !driver) {
      terminal = true;
      result = { ok: false, error: 'Trip, student or driver no longer exists.', deliveredTo: null };
    } else {
      let payload = job.get('payload') as ReturnType<typeof prepareScheduleEmail> | null;
      if (!payload) {
        payload = prepareScheduleEmail({ to: job.get('to'), studentName: student.firstName,
          driverName: driver.firstName + ' ' + driver.lastName, destination: schedule.destination,
          pickupLabel: schedule.pickupLabel, tripAt: schedule.tripAt });
      }
      const saved = await EmailOutbox.updateOne({ _id: job._id, leaseToken: token, leaseUntil: { $gt: new Date() } },
        { payload, firstAttemptAt: first ?? new Date() });
      if (!saved.matchedCount) return true;
      try { result = await send(payload, 'schedule/' + String(job._id)); }
      catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'Email failed.', deliveredTo: null }; }
    }
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const status = result.ok ? 'sent' : terminal || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const sentAt = result.ok ? new Date() : null;
      const updated = await EmailOutbox.updateOne({ _id: job._id, leaseToken: token, status: 'sending' }, {
        status, sentAt, lastError: result.error, providerMessageId: result.providerMessageId ?? null,
        leaseToken: null, leaseUntil: null,
        nextRunAt: new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** (attempts - 1))),
      }, { session });
      if (!updated.matchedCount) return;
      await RideSchedule.updateOne({ _id: job.get('rideSchedule') }, {
        emailStatus: result.ok ? 'sent' : status === 'failed' ? 'failed' : 'pending', sentAt, emailError: result.error,
      }, { session });
    });
  } finally { await session.endSession(); }
  return true;
}

let started = false;
export function startEmailWorker() {
  if (started) return;
  started = true;
  async function tick() {
    try { await processEmailJob(); }
    catch (error) { console.error('[email-worker]', error); } // Lease makes an interrupted job recoverable.
    finally { const timer = setTimeout(tick, 1000); timer.unref(); }
  }
  void tick();
}
