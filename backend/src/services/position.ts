/** Position validation: coordinates, accuracy, timestamp age, clock skew, ordering. */

export const MAX_PING_AGE_MS = 60_000;
export const MAX_CLOCK_SKEW_MS = 10_000;
export const MAX_ACCURACY_METERS = 200;

export interface PingInput {
  lat: unknown;
  lng: unknown;
  accuracyMeters: unknown;
  measuredAt: unknown;
  seq: unknown;
}

export interface ValidPing {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  measuredAt: Date;
  seq: number;
}

export function validatePing(input: PingInput): { ok: true; value: ValidPing } | { ok: false; message: string } {
  const { lat, lng, accuracyMeters, measuredAt, seq } = input;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: 'A position is required.' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, message: 'Position is out of range.' };
  }
  let accuracy: number | null = null;
  if (accuracyMeters !== undefined && accuracyMeters !== null) {
    if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
      return { ok: false, message: 'Accuracy is invalid.' };
    }
    if (accuracyMeters > MAX_ACCURACY_METERS) {
      return { ok: false, message: 'GPS fix is too inaccurate. Wait for a better fix.' };
    }
    accuracy = Math.round(accuracyMeters);
  }
  if (typeof measuredAt !== 'string') return { ok: false, message: 'Measurement time is required.' };
  const measured = new Date(measuredAt as string);
  if (Number.isNaN(measured.getTime())) {
    return { ok: false, message: 'Measurement time is invalid.' };
  }
  if (typeof seq !== 'number' || !Number.isFinite(seq)) {
    return { ok: false, message: 'Update sequence is required.' };
  }
  const age = Date.now() - measured.getTime();
  if (age > MAX_PING_AGE_MS) {
    return { ok: false, message: 'GPS fix is stale. Waiting for a fresh fix.' };
  }
  if (age < -MAX_CLOCK_SKEW_MS) {
    return { ok: false, message: 'Device clock looks wrong. Check date/time settings.' };
  }
  return { ok: true, value: { lat, lng, accuracyMeters: accuracy, measuredAt: measured, seq: Math.floor(seq) } };
}
