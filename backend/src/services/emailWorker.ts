import { EmailOutbox, RideRequest, RideSchedule, Student } from '../models/index.js';
import { sendScheduleEmail } from './email.js';

const POLL_MS = 15_000;
const MAX_ATTEMPTS = 8;
let started = false;

/** Bounded retries with exponential backoff; recovers on restart via pending jobs. */
export function startEmailWorker() {
  if (started) return;
  started = true;
  async function tick() {
    try {
      const now = new Date();
      const job = await EmailOutbox.findOneAndUpdate(
        { status: { $in: ['pending', 'failed'] }, nextRunAt: { $lte: now }, attempts: { $lt: MAX_ATTEMPTS } },
        { status: 'sending' },
        { sort: { nextRunAt: 1 }, returnDocument: 'after' },
      );
      if (job) {
        const schedule = await RideSchedule.findById(job.get('rideSchedule'));
        const request = await RideRequest.findById(job.get('rideRequest')).lean();
        const student = request ? await Student.findById(request.student).lean() : null;
        if (!request || !student || !schedule) {
          await EmailOutbox.updateOne(
            { _id: job._id },
            { status: 'failed', lastError: 'Trip or student no longer exists.' },
          );
        } else {
          const result = await sendScheduleEmail({
            to: (job.get('to') as string) ?? (student.email as string),
            studentName: student.firstName as string,
            driverName: 'LC Shuttle driver',
            destination: schedule.get('destination'),
            pickupLabel: schedule.get('pickupLabel'),
            tripAt: schedule.get('tripAt'),
          });
          const attempts = (job.get('attempts') as number) + 1;
          if (result.ok) {
            await EmailOutbox.updateOne(
              { _id: job._id },
              { status: 'sent', sentAt: new Date(), lastError: null, attempts },
            );
            await RideSchedule.updateOne(
              { _id: schedule._id },
              { emailStatus: 'sent', sentAt: new Date(), emailError: null },
            );
          } else {
            const backoff = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
            await EmailOutbox.updateOne(
              { _id: job._id },
              {
                status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
                attempts,
                nextRunAt: new Date(Date.now() + backoff),
                lastError: result.error,
              },
            );
            await RideSchedule.updateOne(
              { _id: schedule._id },
              { emailStatus: 'failed', emailError: result.error },
            );
          }
        }
      }
    } catch (error) {
      console.error('[email-worker]', error);
    } finally {
      setTimeout(tick, POLL_MS);
    }
  }
  setTimeout(tick, 3000);
}
