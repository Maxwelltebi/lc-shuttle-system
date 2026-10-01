import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthToken, isBackendConnected } from '../api/client';
import type { Bus } from '../types';

const BASE = import.meta.env.VITE_API_URL ?? '';

export type SocketState = 'connected' | 'disconnected';

/** Authenticated socket; reconnects with backoff. Null when no backend. */
export function useSocket(onFleet: (buses: Bus[]) => void, onBus: (bus: Bus) => void) {
  const [state, setState] = useState<SocketState>('disconnected');
  const ref = useRef<Socket | null>(null);
  const fleetRef = useRef(onFleet);
  fleetRef.current = onFleet;
  const busRef = useRef(onBus);
  busRef.current = onBus;

  useEffect(() => {
    if (!isBackendConnected || !BASE) return;
    const token = getAuthToken();
    if (!token) return;
    const socket = io(BASE, { auth: { token }, reconnection: true, reconnectionDelay: 2000 });
    ref.current = socket;
    socket.on('connect', () => {
      setState('connected');
      socket.emit('student:subscribe');
    });
    socket.on('disconnect', () => setState('disconnected'));
    socket.on('fleet:snapshot', (buses: Bus[]) => fleetRef.current(buses));
    socket.on('bus:position', (bus: Bus) => busRef.current(bus));
    return () => {
      socket.disconnect();
      ref.current = null;
    };
  }, []);

  return { socketRef: ref, state };
}

/** Driver send with ack timeout — caller falls back to HTTP. */
export function sendPositionViaSocket(
  socket: Socket | null,
  payload: { busId: string; lat: number; lng: number; accuracyMeters: number | null; measuredAt: string; seq: number },
  timeoutMs = 4000,
): Promise<boolean> {
  return new Promise((resolve) => {
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
    }, timeoutMs);
    socket.emit('driver:position-update', payload, (res: { ok?: boolean }) => {
      if (!done) {
        done = true;
        window.clearTimeout(timer);
        resolve(Boolean(res?.ok));
      }
    });
  });
}
