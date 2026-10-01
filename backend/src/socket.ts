import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Bus, Driver, Stop } from './models/index.js';
import { toBus } from './serialise.js';
import { computeArrivals, scheduleOffsetMinutes, type StopTiming } from './services/schedule.js';
import { applyPositionUpdate } from './routes/tracking.js';
import type { TokenPayload } from './middleware/auth.js';

const SECRET = process.env.JWT_SECRET ?? 'lc-shuttle-dev-secret';
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

async function stopTimings(): Promise<StopTiming[]> {
  const stops = await Stop.find().sort({ sequence: 1 }).lean();
  return stops.map((s) => ({
    id: String(s._id),
    sequence: s.sequence as number,
    lat: s.lat as number,
    lng: s.lng as number,
    offsetMinutes: s.offsetMinutes as number,
  }));
}

async function fleetPayload() {
  const [buses, timings] = await Promise.all([Bus.find().lean(), stopTimings()]);
  return buses.map((bus) => {
    const next = bus.nextStop ? timings.find((t) => t.id === String(bus.nextStop)) : null;
    const lat = typeof bus.lat === 'number' ? bus.lat : null;
    const lng = typeof bus.lng === 'number' ? bus.lng : null;
    const offset = bus.onDuty && lat !== null && lng !== null && next
      ? scheduleOffsetMinutes({ lat, lng }, next)
      : null;
    return toBus(bus, offset);
  });
}

export function attachSockets(http: HttpServer) {
  const io = new Server(http, { cors: { origin: ORIGIN } });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string) ?? null;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, SECRET) as TokenPayload;
      const account = payload.role === 'driver'
        ? await Driver.findById(payload.sub).lean()
        : null;
      // Students allowed without DB lookup gate; drivers need approval + bus.
      if (payload.role === 'driver') {
        if (!account) return next(new Error('unauthorized'));
        if (!account.approved) return next(new Error('not_approved'));
      }
      socket.data.auth = payload;
      socket.data.accountId = payload.sub;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth as TokenPayload;
    if (auth.role === 'student') socket.join('students');
    else socket.join('drivers');

    socket.on('student:subscribe', async () => {
      try {
        socket.emit('fleet:snapshot', await fleetPayload());
      } catch { /* snapshot on next poll */ }
    });

    socket.on('driver:position-update', async (body, ack?: (res: unknown) => void) => {
      try {
        if (auth.role !== 'driver') {
          ack?.({ ok: false, message: 'Only drivers can do that.' });
          return;
        }
        const busId = (body as { busId?: string })?.busId;
        if (!busId) {
          ack?.({ ok: false, message: 'busId is required.' });
          return;
        }
        const result = await applyPositionUpdate(busId, socket.data.accountId, body);
        if (!result.ok) {
          ack?.({ ok: false, message: result.message, stale: result.code === 'stale' });
          return;
        }
        const [buses, timings] = await Promise.all([Bus.find().lean(), stopTimings()]);
        const saved = buses.find((b) => String(b._id) === String(busId));
        if (saved) {
          const next = saved.nextStop ? timings.find((t) => t.id === String(saved.nextStop)) : null;
          const lat = typeof saved.lat === 'number' ? saved.lat : null;
          const lng = typeof saved.lng === 'number' ? saved.lng : null;
          const offset = saved.onDuty && lat !== null && lng !== null && next
            ? scheduleOffsetMinutes({ lat, lng }, next)
            : null;
          const payload = toBus(saved, offset);
          io.to('students').emit('bus:position', payload);
          const arrivals = computeArrivals(
            timings,
            lat !== null && lng !== null ? { lat, lng } : null,
            saved.nextStop ? String(saved.nextStop) : null,
          ).map((a) => ({ ...a, busId: String(saved._id) }));
          io.to('students').emit('bus:arrivals', { busId: String(saved._id), arrivals });
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, message: 'Something went wrong. Try again.' });
      }
    });
  });

  return io;
}
