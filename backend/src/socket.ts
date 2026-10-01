import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Driver, Student } from './models/index.js';
import { applyPositionUpdate } from './routes/tracking.js';
import { fleetEvents, readFleet } from './services/fleet.js';
import type { TokenPayload } from './middleware/auth.js';

export function attachSockets(http: HttpServer) {
  const io = new Server(http, { cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' } });
  async function eligible(token: string) {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'lc-shuttle-dev-secret') as TokenPayload;
    if (payload.role !== 'driver' && payload.role !== 'student') throw new Error('unauthorized');
    const account = payload.role === 'driver'
      ? await Driver.exists({ _id: payload.sub, approved: true })
      : await Student.exists({ _id: payload.sub });
    if (!account) throw new Error('unauthorized');
    return payload;
  }
  io.use(async (socket, next) => {
    try { socket.data.auth = await eligible(socket.handshake.auth?.token); next(); }
    catch { next(new Error('unauthorized')); }
  });
  io.on('connection', socket => {
    socket.use(async (_packet, next) => {
      try { socket.data.auth = await eligible(socket.handshake.auth?.token); next(); }
      catch { socket.disconnect(true); next(new Error('unauthorized')); }
    });
    socket.on('student:subscribe', async () => {
      if (socket.data.auth.role !== 'student') return;
      try { socket.emit('fleet:snapshot', (await readFleet()).map(row => row.bus)); }
      catch { /* HTTP reconciliation remains available. */ }
    });
    socket.on('driver:position-update', async (body, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (socket.data.auth.role !== 'driver' || typeof body?.busId !== 'string') return reply({ ok: false });
        reply(await applyPositionUpdate(body.busId, socket.data.auth.sub, body));
      } catch { reply({ ok: false, message: 'Position upload failed.' }); }
    });
  });
  async function broadcast(busId: string) {
    try {
      const row = (await readFleet()).find(row => row.bus.id === busId);
      if (!row) return;
      // Recheck membership before every push, including deletion/revocation and token expiry.
      await Promise.all([...io.sockets.sockets.values()].map(async socket => {
        try {
          const auth = await eligible(socket.handshake.auth?.token);
          if (auth.role === 'student') socket.emit('bus:position', row.bus);
        } catch { socket.disconnect(true); }
      }));
    } catch (error) { console.error('Fleet broadcast failed', error); }
  }
  const listener = (id: string) => { void broadcast(id); };
  fleetEvents.on('changed', listener);
  http.on('close', () => fleetEvents.off('changed', listener));
  return io;
}
