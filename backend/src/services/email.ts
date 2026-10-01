import { Resend } from 'resend';

/**
 * Schedule emails (FR3.7).
 *
 * Sending is best-effort by design: a failed send must never lose the
 * schedule. The caller saves the record either way and surfaces
 * `emailStatus: 'failed'` to the driver, because a schedule the student
 * never received is the same as no schedule.
 *
 * Delivery limits on the free tier
 * --------------------------------
 * Without a verified domain, Resend only delivers to the address that
 * owns the account. Every student address is rejected with a 403. Two
 * consequences:
 *
 *   1. `EMAIL_REDIRECT_TO` lets development send every schedule to one
 *      deliverable inbox, with the intended recipient printed at the top
 *      of the message. That makes the feature testable end to end
 *      without pretending it is delivering to students.
 *
 *   2. When Resend rejects a recipient, the driver is told *why* in
 *      words they can act on, rather than being shown a raw API error.
 *
 * The fix for production is to verify a domain at resend.com/domains and
 * point RESEND_FROM at it.
 */

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? 'LC Shuttle <onboarding@resend.dev>';

/** Development only: send everything here instead of the real student. */
const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim() || null;



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
  providerMessageId?: string;
  error: string | null;
  /** Where the message actually went, when redirected in development. */
  deliveredTo: string | null;
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

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The message body.
 *
 * This is the only thing a student actually receives from Module 3, so
 * it carries the app's visual language rather than being a bare wall of
 * text: the same warm ground, navy ink and amber rule. Table-based
 * layout and inline styles because that is what mail clients support.
 */
function renderHtml(input: ScheduleEmailInput, redirectNotice: string | null) {
  const when = formatTrip(input.tripAt);

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 0;color:#5c6472;font-size:14px;width:120px;vertical-align:top;">${label}</td>
      <td style="padding:10px 0;color:#1a2744;font-size:15px;font-weight:600;">${escape(value)}</td>
    </tr>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f8f6f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f2;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #eeebe6;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        ${
          redirectNotice
            ? `<tr><td style="background:#fdf7ef;border-bottom:1px solid #e8d5b5;padding:12px 28px;color:#c4852a;font-size:13px;">
                 ${escape(redirectNotice)}
               </td></tr>`
            : ''
        }

        <tr><td style="padding:28px 28px 0;">
          <span style="display:inline-block;background:#1a2744;color:#ffffff;font-size:13px;font-weight:700;padding:8px 10px;border-radius:8px;letter-spacing:0.02em;">LC</span>
        </td></tr>

        <tr><td style="padding:20px 28px 0;">
          <h1 style="margin:0;font-size:22px;line-height:1.25;color:#1a2744;letter-spacing:-0.02em;">Your ride is scheduled</h1>
          <p style="margin:8px 0 0;color:#5c6472;font-size:15px;line-height:1.5;">
            Hi ${escape(input.studentName)}, ${escape(input.driverName)} has confirmed your trip.
          </p>
        </td></tr>

        <tr><td style="padding:20px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-top:1px solid #eeebe6;border-bottom:1px solid #eeebe6;">
            ${row('When', when)}
            ${row('Pickup', input.pickupLabel)}
            ${row('Destination', input.destination)}
            ${row('Driver', input.driverName)}
          </table>
        </td></tr>

        <tr><td style="padding:20px 28px 0;">
          <p style="margin:0;color:#5c6472;font-size:14px;line-height:1.5;">
            Please be at the pickup point a few minutes early. This trip is
            off the regular loop, so it is not shown on the live map.
          </p>
        </td></tr>

        <tr><td style="padding:24px 28px 28px;">
          <p style="margin:0;padding-top:16px;border-top:1px solid #eeebe6;color:#8c95a6;font-size:12px;">
            LC Shuttle — Livingstone College, Salisbury NC<br>
            You are receiving this because you requested this trip.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText(input: ScheduleEmailInput, redirectNotice: string | null) {
  return [
    ...(redirectNotice ? [redirectNotice, ''] : []),
    `Hi ${input.studentName},`,
    '',
    `${input.driverName} has scheduled your ride.`,
    '',
    `When:        ${formatTrip(input.tripAt)}`,
    `Pickup:      ${input.pickupLabel}`,
    `Destination: ${input.destination}`,
    '',
    'Please be at the pickup point a few minutes early. This trip is off',
    'the regular loop, so it is not shown on the live map.',
    '',
    'LC Shuttle — Livingstone College',
  ].join('\n');
}

/** Turn Resend's sandbox rejection into something a driver can act on. */
function explain(message: string): string {
  if (message.includes('your own email address')) {
    return 'The email service is still in test mode and can only deliver to the account owner. Verify a domain at resend.com/domains to reach students.';
  }
  return message;
}

export function prepareScheduleEmail(input: ScheduleEmailInput) {
  const recipient = redirectTo ?? input.to;
  const notice = redirectTo ? 'Development copy. This message was addressed to ' + input.to : null;
  return {
    from, to: recipient,
    subject: 'Your ride to ' + input.destination + ' ? ' + formatTrip(input.tripAt),
    html: renderHtml(input, notice), text: renderText(input, notice),
  };
}

/** A frozen payload plus a stable key makes restart retries safe within the provider window. */
export async function sendPreparedEmail(payload: ReturnType<typeof prepareScheduleEmail>, idempotencyKey: string): Promise<EmailResult> {
  if (!apiKey) return { ok: false, error: 'No email service is configured.', deliveredTo: null };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { id?: string; message?: string };
    if (!response.ok || !result.id) return { ok: false, error: explain(result.message ?? 'Email provider rejected the message.'), deliveredTo: null };
    return { ok: true, error: null, deliveredTo: payload.to, providerMessageId: result.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Email request failed.', deliveredTo: null };
  }
}
