import { useEffect, useRef, useState } from 'react';
import { pingPosition } from '../api/tracking';

/**
 * Broadcasts the driver's position while they are on duty (FR1.1).
 *
 * This is the only thing that puts a bus on a student's map. Everything
 * else in Module 1 is downstream of it.
 *
 * Two deliberate choices:
 *
 * `watchPosition` gives readings whenever the device has them, but the
 * server is only told every 10 seconds. Posting on every reading would
 * hammer the API in a moving vehicle for no extra accuracy.
 *
 * Nothing is sent when off duty. The watch is torn down entirely rather
 * than left running and filtered, so a driver who goes off duty is not
 * still being tracked by their own phone.
 */

const PING_INTERVAL_MS = 10_000;

export interface BroadcastState {
  /** Last reading taken from the device, whether or not it was sent. */
  position: GeolocationPosition | null;
  /** Set when the browser refuses or cannot get a fix. */
  error: string | null;
  /** True once a ping has been accepted by the server. */
  sending: boolean;
}

export function useLocationBroadcast(
  busId: string | null,
  onDuty: boolean,
): BroadcastState {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /* Held in a ref so the send timer always reads the newest fix without
     restarting on every reading. */
  const latest = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (!busId || !onDuty) {
      setPosition(null);
      setError(null);
      setSending(false);
      latest.current = null;
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('This device cannot share its location.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (next) => {
        latest.current = next;
        setPosition(next);
        setError(null);
      },
      (caught) => {
        setError(
          caught.code === caught.PERMISSION_DENIED
            ? 'Location permission is off. Students cannot see this bus until you allow it.'
            : 'Could not get a location fix.',
        );
      },
      {
        enableHighAccuracy: true,
        /* A fix older than the ping interval is not worth sending. */
        maximumAge: PING_INTERVAL_MS,
        timeout: 20_000,
      },
    );

    const timer = window.setInterval(async () => {
      const fix = latest.current;
      if (!fix) return;
      try {
        await pingPosition(busId, {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracyMeters: fix.coords.accuracy
            ? Math.round(fix.coords.accuracy)
            : null,
        });
        setSending(true);
        setError(null);
      } catch {
        /* A dropped ping is not worth interrupting the driver over: the
           next one is ten seconds away, and the map already greys the
           bus out after two minutes of silence. */
        setSending(false);
      }
    }, PING_INTERVAL_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [busId, onDuty]);

  return { position, error, sending };
}
