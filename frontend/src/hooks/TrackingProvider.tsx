import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthToken, isBackendConnected } from '../api/client';
import { pingPosition } from '../api/tracking';
import type { TransportMode } from '../types';
import { useSession } from './useSession';
import { useMyBus } from './useMyBus';

const BASE = import.meta.env.VITE_API_URL ?? '';
const PING_INTERVAL_MS = 10_000;

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

interface TrackingValue {
  bus: ReturnType<typeof useMyBus>['bus'];
  setBus: ReturnType<typeof useMyBus>['setBus'];
  loading: boolean;
  permission: PermissionState;
  transport: TransportMode;
  lastFixAt: string | null;
  lastUploadAt: string | null;
  lastUploadError: string | null;
  connected: boolean;
  position: { lat: number; lng: number; accuracy: number | null } | null;
}

const TrackingContext = createContext<TrackingValue>({
  bus: null, setBus: () => {}, loading: true,
  permission: 'prompt',
  transport: 'offline',
  lastFixAt: null,
  lastUploadAt: null,
  lastUploadError: null,
  connected: false,
  position: null,
});

export function useTracking() {
  return useContext(TrackingContext);
}

/**
 * Persistent driver-session GPS provider. Mounted above driver routes so
 * navigation between Duty/Board/Queue never stops broadcast. Stops on
 * off-duty or logout.
 */
export function TrackingProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { bus, setBus, loading } = useMyBus();
  const [permission, setPermission] = useState<PermissionState>('prompt');
  const [transport, setTransport] = useState<TransportMode>('offline');
  const [lastFixAt, setLastFixAt] = useState<string | null>(null);
  const [lastUploadAt, setLastUploadAt] = useState<string | null>(null);
  const [lastUploadError, setLastUploadError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);

  const latest = useRef<{ lat: number; lng: number; accuracy: number | null; measuredAt: string } | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const busId = user?.role === 'driver' ? (user.busId ?? null) : null;
  const onDuty = bus?.onDuty ?? false;
  const active = Boolean(busId && onDuty && isBackendConnected);

  const sendViaSocket = useCallback(
    (payload: { busId: string; lat: number; lng: number; accuracyMeters: number | null; measuredAt: string; seq: number }) =>
      new Promise<boolean>((resolve) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          resolve(false);
          return;
        }
        let done = false;
        const timer = window.setTimeout(() => {
          if (!done) {
            done = true;
            resolve(false);
          }
        }, 4000);
        socket.emit('driver:position-update', payload, (res: { ok?: boolean }) => {
          if (!done) {
            done = true;
            window.clearTimeout(timer);
            resolve(Boolean(res?.ok));
          }
        });
      }),
    [],
  );

  // Socket lifecycle: one connection per driver session.
  useEffect(() => {
    if (!busId || user?.role !== 'driver' || !isBackendConnected || !BASE) return;
    const token = getAuthToken();
    if (!token) return;
    const socket = io(BASE, { auth: { token }, reconnection: true, reconnectionDelay: 2000 });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => {
      setConnected(false);
      setTransport('offline');
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [busId, user?.role]);

  // GPS watch: persists across screens.
  useEffect(() => {
    if (!active || !busId) {
      latest.current = null;
      setTransport('offline');
      setPosition(null);
      return;
    }
    if (!('geolocation' in navigator)) {
      setPermission('unavailable');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (next) => {
        latest.current = {
          lat: next.coords.latitude,
          lng: next.coords.longitude,
          accuracy: next.coords.accuracy ? Math.round(next.coords.accuracy) : null,
          measuredAt: new Date(next.timestamp).toISOString(),
        };
        setLastFixAt(new Date(next.timestamp).toISOString());
        setPosition({
          lat: next.coords.latitude,
          lng: next.coords.longitude,
          accuracy: next.coords.accuracy ? Math.round(next.coords.accuracy) : null,
        });
        setPermission('granted');
      },
      (caught) => {
        latest.current = null;
        setLastUploadError(caught.message);
        setPermission(caught.code === caught.PERMISSION_DENIED ? 'denied' : 'prompt');
      },
      { enableHighAccuracy: true, maximumAge: PING_INTERVAL_MS, timeout: 20_000 },
    );

    let cancelled = false;
    let sending = false;
    let uploadedMeasurement: string | null = null;
    const timer = window.setInterval(async () => {
      const fix = latest.current;
      if (!fix || sending || fix.measuredAt === uploadedMeasurement) return;
      if (Date.now() - Date.parse(fix.measuredAt) > 60_000) { setLastUploadError('Waiting for fresh GPS.'); return; }
      sending = true;
      try {
        const payload = {
          busId,
          lat: fix.lat,
          lng: fix.lng,
          accuracyMeters: fix.accuracy,
          measuredAt: fix.measuredAt,
          seq: Date.parse(fix.measuredAt),
        };
        // Primary: socket. Fallback: HTTP.
        const viaSocket = await sendViaSocket(payload);
        if (cancelled) return;
        if (viaSocket) {
          uploadedMeasurement = fix.measuredAt;
          setTransport('socket');
          setLastUploadAt(new Date().toISOString());
          setLastUploadError(null);
          return;
        }
        try {
          await pingPosition(busId, payload);
          if (cancelled) return;
          uploadedMeasurement = fix.measuredAt;
          setTransport('http');
          setLastUploadAt(new Date().toISOString());
          setLastUploadError(null);
        } catch (e) {
          if (cancelled) return;
          setTransport('offline');
          setLastUploadError((e as { message?: string })?.message ?? 'Upload failed. Retrying…');
        }
      } finally { sending = false; }
    }, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [active, busId, sendViaSocket]);

  // Off-duty/logout cleanup.
  useEffect(() => {
    if (!onDuty || !busId) {
      latest.current = null;
      setTransport('offline');
      setLastUploadError(null);
    }
  }, [onDuty, busId]);

  const value = useMemo(
    () => ({ bus, setBus, loading, permission, transport, lastFixAt, lastUploadAt, lastUploadError, connected, position }),
    [bus, setBus, loading, permission, transport, lastFixAt, lastUploadAt, lastUploadError, connected, position],
  );
  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}
