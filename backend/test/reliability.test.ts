import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Bus, Driver, Student, Stop, WaitingCheckIn, RideRequest, RideSchedule, EmailOutbox } from '../src/models/index.js';
import { prepareDatabase } from '../src/services/database.js';
import { trackingRouter, applyPositionUpdate } from '../src/routes/tracking.js';
import { waitingRouter } from '../src/routes/waiting.js';
import { requestsRouter, schedulesRouter } from '../src/routes/requests.js';
import { issueToken } from '../src/middleware/auth.js';
import { attachSockets } from '../src/socket.js';
import { processEmailJob } from '../src/services/emailWorker.js';
import { validatePing } from '../src/services/position.js';
import { busStatus } from '../src/serialise.js';
import { mergeFleet, ageFleet } from '../../frontend/src/hooks/fleetState.ts';

const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { io: connect } = requireFrontend('socket.io-client');
let replica: MongoMemoryReplSet;
let server: ReturnType<typeof createServer>;
let sockets: ReturnType<typeof attachSockets>;
let base: string;
let driver: any, other: any, student: any, bus: any, stop: any;
let driverToken: string, studentToken: string, otherToken: string;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri(), { autoIndex: false });
  await prepareDatabase();
  driver = await Driver.create({ firstName: 'Test', lastName: 'Driver', email: 'driver@test.invalid', passwordHash: 'unused', approved: true });
  other = await Driver.create({ firstName: 'Other', lastName: 'Driver', email: 'other@test.invalid', passwordHash: 'unused', approved: true });
  student = await Student.create({ firstName: 'Test', lastName: 'Student', email: 'student@test.invalid', passwordHash: 'unused' });
  bus = await Bus.create({ label: 'Test bus', driver: driver._id, onDuty: true });
  stop = await Stop.create({ name: 'Stop', address: 'Test', lat: 35, lng: -80, sequence: 1, offsetMinutes: 0 });
  driverToken = issueToken({ sub: String(driver._id), role: 'driver' });
  otherToken = issueToken({ sub: String(other._id), role: 'driver' });
  studentToken = issueToken({ sub: String(student._id), role: 'student' });
  const app = express();
  app.use(express.json());
  app.use('/api', trackingRouter);
  app.use('/api/waiting', waitingRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/schedules', schedulesRouter);
  app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ message: error.message }));
  server = createServer(app);
  sockets = attachSockets(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  if (sockets) await new Promise<void>(resolve => sockets.close(() => resolve()));
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
async function api(path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
}
function ping(time = Date.now(), seq = 1) { return { lat: 35, lng: -80, accuracyMeters: 10, measuredAt: new Date(time).toISOString(), seq }; }
function event(socket: any, name: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Timed out: ${name}`)); }, 5000);
    function done(value: any) { clearTimeout(timer); resolve(value); }
    socket.once(name, done);
  });
}
test('freshness rejects missing timestamps and ages the measurement, not receipt', () => {
  assert.equal(validatePing({ ...ping(), measuredAt: undefined }).ok, false);
  assert.equal(validatePing(ping(Date.now() - 61_000)).ok, false);
  assert.equal(busStatus({ onDuty: true, lat: 35, lng: -80, measuredAt: new Date(Date.now() - 121_000), lastPingAt: new Date() }), 'offline');
});
test('concurrent updates cannot regress; refreshed client counter and duplicate retry work', async () => {
  const now = Date.now() - 1000;
  const newer = ping(now, 1);
  await Promise.all([applyPositionUpdate(String(bus._id), String(driver._id), newer),
    applyPositionUpdate(String(bus._id), String(driver._id), ping(now - 1000, 900))]);
  const saved = await Bus.findById(bus._id).lean();
  assert.equal(saved!.measuredAt!.getTime(), now);
  assert.equal((await applyPositionUpdate(String(bus._id), String(driver._id), newer)).ok, true);
  const again = await Bus.findById(bus._id).lean();
  assert.equal(again!.revision, saved!.revision);
  assert.equal(again!.lastPingAt!.getTime(), saved!.lastPingAt!.getTime());
  assert.equal((await applyPositionUpdate(String(bus._id), String(driver._id), ping(now + 1, 0))).ok, true);
});
test('HTTP uploads and off-duty transitions reach socket students; reconnect gets a snapshot', async () => {
  const socket = connect(base, { auth: { token: studentToken }, transports: ['websocket'] });
  try {
    await event(socket, 'connect');
    const update = event(socket, 'bus:position');
    assert.equal((await api(`/api/buses/${bus._id}/ping`, driverToken, ping())).status, 200);
    assert.equal((await update).status, 'live');
    const off = event(socket, 'bus:position');
    assert.equal((await api(`/api/buses/${bus._id}/duty`, driverToken, { onDuty: false })).status, 200);
    assert.equal((await off).position, null);
    socket.disconnect(); socket.connect(); await event(socket, 'connect');
    const snapshot = event(socket, 'fleet:snapshot'); socket.emit('student:subscribe');
    assert.equal((await snapshot)[0].status, 'off_duty');
  } finally { socket.disconnect(); }
});
test('fleet reconciliation never rolls back a newer revision and ages a silent connection', () => {
  const latest: any = { id: 'bus', revision: 2, onDuty: true, status: 'live', position: { measuredAt: new Date(0).toISOString() } };
  assert.equal(mergeFleet([latest], [{ ...latest, revision: 1 }])[0].revision, 2);
  assert.equal(ageFleet([latest], 121_000)[0].status, 'offline');
});
test('simultaneous first check-ins and replacement preserve one waiting record', async () => {
  const results = await Promise.all([api('/api/waiting', studentToken, { stopId: stop.id }), api('/api/waiting', studentToken, { stopId: stop.id })]);
  assert(results.every(r => [201, 409].includes(r.status)), JSON.stringify(results));
  assert.equal(await WaitingCheckIn.countDocuments({ student: student._id, status: 'waiting' }), 1);
  const replacement = await api('/api/waiting', studentToken, { stopId: stop.id });
  assert.equal(replacement.status, 201, JSON.stringify(replacement));
  assert.equal(await WaitingCheckIn.countDocuments({ student: student._id, status: 'waiting' }), 1);
});
let scheduled: any;
test('scheduling is atomic and idempotent with conflicting retries rejected', async () => {
  const request = await RideRequest.create({ reference: 'RR-test', student: student._id, destination: 'Test', pickupLabel: 'Stop', requestedAt: new Date(Date.now() + 3600_000), status: 'claimed', claimedBy: driver._id, claimedAt: new Date() });
  const input = { tripAt: new Date(Date.now() + 7200_000).toISOString() };
  const results = await Promise.all([api(`/api/requests/${request.id}/schedule`, driverToken, input), api(`/api/requests/${request.id}/schedule`, driverToken, input)]);
  assert(results.every(r => [200, 201].includes(r.status)), JSON.stringify(results));
  scheduled = results[0].body;
  assert.equal(results[1].body.id, scheduled.id);
  assert.equal(await RideSchedule.countDocuments({ rideRequest: request._id }), 1);
  assert.equal(await EmailOutbox.countDocuments({ rideRequest: request._id }), 1);
  assert.equal((await api(`/api/requests/${request.id}/schedule`, driverToken, { tripAt: new Date(Date.now() + 9999_000).toISOString() })).status, 409);
  assert.equal((await api(`/api/schedules/${scheduled.id}/resend`, otherToken, {})).status, 403);
  assert.equal((await api('/api/schedules/deliveries', otherToken)).body.length, 0);
});
test('outbox write failure rolls back schedule and request together', async () => {
  const request = await RideRequest.create({ reference: 'RR-rollback', student: student._id, destination: 'Test', pickupLabel: 'Stop', requestedAt: new Date(Date.now() + 3600_000), status: 'claimed', claimedBy: driver._id, claimedAt: new Date() });
  const original = EmailOutbox.create;
  EmailOutbox.create = (async () => { throw new Error('Injected outbox failure'); }) as any;
  try {
    assert.equal((await api(`/api/requests/${request.id}/schedule`, driverToken, { tripAt: new Date(Date.now() + 3600_000).toISOString() })).status, 500);
    assert.equal(await RideSchedule.countDocuments({ rideRequest: request._id }), 0);
    assert.equal((await RideRequest.findById(request._id))!.status, 'claimed');
  } finally { EmailOutbox.create = original; }
});
test('expired sending lease recovers, concurrent workers send once, statuses commit together', async () => {
  await EmailOutbox.updateOne({ rideSchedule: scheduled.id }, { status: 'sending', leaseUntil: new Date(0), leaseToken: 'dead-worker' });
  let calls = 0;
  const provider = async (_payload: unknown, key: string) => { calls++; assert.match(key, /^schedule\//); return { ok: true, error: null, deliveredTo: 'test', providerMessageId: 'fake-provider-id' }; };
  await Promise.all([processEmailJob(provider), processEmailJob(provider)]);
  assert.equal(calls, 1);
  assert.equal((await EmailOutbox.findOne({ rideSchedule: scheduled.id }))!.status, 'sent');
  assert.equal((await RideSchedule.findById(scheduled.id))!.emailStatus, 'sent');
});
test('exhausted failed jobs can be manually retried with stable payload identity', async () => {
  await EmailOutbox.updateOne({ rideSchedule: scheduled.id }, { status: 'failed', attempts: 8 });
  assert.equal((await api(`/api/schedules/${scheduled.id}/resend`, driverToken, {})).status, 200);
  assert.equal((await EmailOutbox.findOne({ rideSchedule: scheduled.id }))!.attempts, 0);
  await processEmailJob(async () => ({ ok: false, error: 'Temporary outage', deliveredTo: null }));
  assert.equal((await EmailOutbox.findOne({ rideSchedule: scheduled.id }))!.status, 'pending');
  assert.equal((await RideSchedule.findById(scheduled.id))!.emailStatus, 'pending');
});

test('provider acceptance followed by database failure recovers using the same key and payload', async () => {
  await EmailOutbox.updateOne({ rideSchedule: scheduled.id }, { status: 'pending', nextRunAt: new Date(0) });
  const accepted = new Map<string, string>();
  let calls = 0;
  const provider = async (payload: any, key: string) => {
    calls++;
    const serialized = JSON.stringify(payload);
    if (accepted.has(key)) assert.equal(accepted.get(key), serialized);
    else accepted.set(key, serialized);
    return { ok: true, error: null, deliveredTo: payload.to, providerMessageId: 'stable-id' };
  };
  const original = RideSchedule.updateOne;
  RideSchedule.updateOne = (() => { throw new Error('Database completion unavailable'); }) as any;
  try { await assert.rejects(processEmailJob(provider), /Database completion/); }
  finally { RideSchedule.updateOne = original; }
  assert.equal((await EmailOutbox.findOne({ rideSchedule: scheduled.id }))!.status, 'sending');
  await EmailOutbox.updateOne({ rideSchedule: scheduled.id }, { leaseUntil: new Date(0) });
  await processEmailJob(provider);
  assert.equal(calls, 2);
  assert.equal(accepted.size, 1);
  assert.equal((await RideSchedule.findById(scheduled.id))!.emailStatus, 'sent');
});

test('past-due requests cannot be claimed and request references are unique under concurrency', async () => {
  const expired = await RideRequest.create({ reference: 'RR-expired', student: student._id, destination: 'Test', pickupLabel: 'Stop', requestedAt: new Date(0), status: 'open' });
  assert.equal((await api(`/api/requests/${expired.id}/claim`, driverToken, {})).status, 409);
  const input = { destination: 'Test', pickupStopId: stop.id, requestedAt: new Date(Date.now() + 3600_000).toISOString() };
  const results = await Promise.all([api('/api/requests', studentToken, input), api('/api/requests', studentToken, input)]);
  assert(results.every(r => r.status === 201), JSON.stringify(results));
  assert.notEqual(results[0].body.reference, results[1].body.reference);
});

test('socket driver loses upload permission when approval is revoked', async () => {
  const socket = connect(base, { auth: { token: driverToken }, transports: ['websocket'] });
  try {
    await event(socket, 'connect');
    await Driver.updateOne({ _id: driver._id }, { approved: false });
    const disconnected = event(socket, 'disconnect');
    socket.emit('driver:position-update', { busId: bus.id, ...ping() }, () => {});
    await disconnected;
    assert.equal(socket.connected, false);
  } finally {
    socket.disconnect();
    await Driver.updateOne({ _id: driver._id }, { approved: true });
  }
});

test('missing outbox relations fail terminally instead of retrying forever', async () => {
  const missing = await EmailOutbox.create({ rideRequest: new mongoose.Types.ObjectId(), rideSchedule: new mongoose.Types.ObjectId(), to: 'test@test.invalid', nextRunAt: new Date(0) });
  await processEmailJob(async () => { throw new Error('Must not contact provider'); });
  assert.equal((await EmailOutbox.findById(missing._id))!.status, 'failed');
  assert.equal(await processEmailJob(async () => { throw new Error('Must not retry'); }), false);
});
