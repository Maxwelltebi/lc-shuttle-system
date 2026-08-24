import { Resend } from 'resend';

/**
 * Schedule emails (FR3.7).
 *
 * Sending is best-effort by design: a failed send must never lose the
 * schedule. The caller saves the record either way and surfaces
 * `emailStatus: 'failed'` to the driver, because a schedule the student
 * never received is the same as no schedule.
 *
 * Known limitation (README, "Email delivery"): on Resend's free
 * onboarding domain, mail only delivers to the account owner's own
 * address. Until a domain is verified, a real student address will fail
 * here — which is exactly why the failure has to be visible rather than
 * swallowed.
 */

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? 'LC Shuttle <onboarding@resend.dev>';

const resend = apiKey ? new Resend(apiKey) : null;

export interface ScheduleEmailInput {
  to: string;
  studentName: string;
  driverName: string;
  destination: string;
  pickupLabel: string;
  tripAt: Date;
}

export interface EmailResult {
  ok: boolean;
  error: string | null;
}

function formatTrip(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export async function sendScheduleEmail(
  input: ScheduleEmailInput,
): Promise<EmailResult> {
  if (!resend) {
    return {
      ok: false,
      error: 'RESEND_API_KEY is not set, so no email was sent.',
    };
  }

  const when = formatTrip(input.tripAt);

  try {
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: `Your ride to ${input.destination} — ${when}`,
      text: [
        `Hi ${input.studentName},`,
        '',
        `${input.driverName} has scheduled your ride.`,
        '',
        `When:        ${when}`,
        `Pickup:      ${input.pickupLabel}`,
        `Destination: ${input.destination}`,
        '',
        'Please be at the pickup point a few minutes early.',
        '',
        'LC Shuttle — Livingstone College',
      ].join('\n'),
    });

    if (error) {
      return { ok: false, error: error.message ?? 'Resend rejected the message.' };
    }
    return { ok: true, error: null };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'Unknown send failure.',
    };
  }
}
