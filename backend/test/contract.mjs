/**
 * End-to-end contract check.
 *
 * Exercises every endpoint the frontend calls and asserts the response
 * shape matches shared/types.ts. Catches the classic MERN mismatches:
 * _id vs id, Date vs ISO string, missing nullable fields.
 */
const BASE = 'http://localhost:4000';
const PW = 'shuttle2026';

let pass = 0;
let fail = 0;

function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const isIso = (v) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) && v.includes('T');
const hasId = (o) =>
  o && typeof o.id === 'string' && o.id.length > 0 && o._id === undefined;

console.log('\n=== stops ===');
const stops = await call('/api/stops');
check('GET /api/stops → 200', stops.status === 200, stops.status);
check('nine stops', stops.body?.length === 9, stops.body?.length);
check('id not _id', hasId(stops.body?.[0]), JSON.stringify(stops.body?.[0]));
check(
  'sequence ordered 1..9',
  stops.body?.every((s, i) => s.sequence === i + 1),
);
check(
  'coordinates numeric',
  typeof stops.body?.[0]?.lat === 'number' && typeof stops.body?.[0]?.lng === 'number',
);

console.log('\n=== auth ===');
const driver1 = await call('/api/auth/signin', {
  method: 'POST',
  body: { email: 'm.tebi@livingstone.edu', password: PW, role: 'driver' },
});
check('driver signin → 200', driver1.status === 200, JSON.stringify(driver1.body));
check('token present', typeof driver1.body?.token === 'string');
check('user.role driver', driver1.body?.user?.role === 'driver');
check('user has busId', driver1.body?.user?.busId != null);
check('approved true', driver1.body?.user?.approved === true);
check('no passwordHash leaked', driver1.body?.user?.passwordHash === undefined);

const driver2 = await call('/api/auth/signin', {
  method: 'POST',
  body: { email: 'i.abakah@livingstone.edu', password: PW, role: 'driver' },
});
check('second driver signin', driver2.status === 200);

const student = await call('/api/auth/signin', {
  method: 'POST',
  body: { email: 'test.student@livingstone.edu', password: PW, role: 'student' },
});
check('student signin → 200', student.status === 200, JSON.stringify(student.body));
check('homeStopId present', student.body?.user?.homeStopId != null);

const wrongRole = await call('/api/auth/signin', {
  method: 'POST',
  body: { email: 'test.student@livingstone.edu', password: PW, role: 'driver' },
});
check('student on driver tab rejected', wrongRole.status === 401, wrongRole.status);

const badPw = await call('/api/auth/signin', {
  method: 'POST',
  body: { email: 'test.student@livingstone.edu', password: 'nope', role: 'student' },
});
check('bad password → 401 unauthorized', badPw.body?.code === 'unauthorized');

const D1 = driver1.body.token;
const D2 = driver2.body.token;
const S = student.body.token;
const busId = driver1.body.user.busId;

console.log('\n=== service status ===');
const service = await call('/api/service-status');
check('has state', ['in_service', 'lunch_break', 'closed'].includes(service.body?.state), service.body?.state);
check('has message', typeof service.body?.message === 'string');
console.log(`       state=${service.body?.state} next=${service.body?.nextDepartureClock}`);

console.log('\n=== buses (off duty) ===');
let buses = await call('/api/buses', { token: S });
check('two buses', buses.body?.length === 2, buses.body?.length);
check('status off_duty', buses.body?.[0]?.status === 'off_duty', buses.body?.[0]?.status);
check('position null when off duty', buses.body?.[0]?.position === null);

console.log('\n=== duty + ping ===');
const onDuty = await call(`/api/buses/${busId}/duty`, {
  method: 'POST',
  token: D1,
  body: { onDuty: true },
});
check('go on duty → 200', onDuty.status === 200, JSON.stringify(onDuty.body));
check('onDuty true', onDuty.body?.onDuty === true);

const ping = await call(`/api/buses/${busId}/ping`, {
  method: 'POST',
  token: D1,
  body: { lat: 35.6712869, lng: -80.4856795, accuracyMeters: 8 },
});
check('ping accepted', ping.status === 200, JSON.stringify(ping.body));

const nextStop = await call(`/api/buses/${busId}/next-stop`, {
  method: 'POST',
  token: D1,
  body: { stopId: stops.body[3].id },
});
check('set next stop → 200', nextStop.status === 200, JSON.stringify(nextStop.body));
check('nextStopId echoes back', nextStop.body?.nextStopId === stops.body[3].id);

buses = await call('/api/buses', { token: S });
const live = buses.body.find((b) => b.id === busId);
check('status live after ping', live?.status === 'live', live?.status);
check('position lastPingAt is ISO', isIso(live?.position?.lastPingAt), live?.position?.lastPingAt);
check('scheduleOffsetMinutes numeric or null',
  live?.scheduleOffsetMinutes === null || typeof live?.scheduleOffsetMinutes === 'number');
console.log(`       offset=${live?.scheduleOffsetMinutes} min`);

console.log('\n=== arrivals ===');
const arrivals = await call(`/api/buses/${busId}/arrivals`, { token: S });
check('nine arrivals', arrivals.body?.length === 9, arrivals.body?.length);
check('busId set', arrivals.body?.[0]?.busId === busId);
const withEta = arrivals.body.filter((a) => a.etaMinutes !== null);
check('etas present while live', withEta.length === 9, withEta.length);

// Loop-order check: walking forward from the next stop, ETAs must ascend.
const bySeq = new Map(stops.body.map((s) => [s.id, s.sequence]));
const nextSeq = bySeq.get(stops.body[3].id);
const walk = [...arrivals.body].sort((a, b) => {
  const sa = (bySeq.get(a.stopId) - nextSeq + 9) % 9;
  const sb = (bySeq.get(b.stopId) - nextSeq + 9) % 9;
  return sa - sb;
});
const ascending = walk.every((a, i) => i === 0 || a.etaMinutes >= walk[i - 1].etaMinutes);
check('ETAs ascend in loop order (not stop order)', ascending,
  walk.map((a) => a.etaMinutes).join(','));
console.log(`       loop order etas: ${walk.map((a) => a.etaMinutes).join(', ')}`);

console.log('\n=== waiting check-ins ===');
let mine = await call('/api/waiting/me', { token: S });
check('no check-in initially', mine.body === null, JSON.stringify(mine.body));

const ci = await call('/api/waiting', {
  method: 'POST',
  token: S,
  body: { stopId: stops.body[7].id },
});
check('check in → 201', ci.status === 201, JSON.stringify(ci.body));
check('createdAt ISO', isIso(ci.body?.createdAt));
check('expiresAt ISO', isIso(ci.body?.expiresAt));
const ttl = Date.parse(ci.body.expiresAt) - Date.parse(ci.body.createdAt);
check('TTL is 90 minutes', ttl === 90 * 60 * 1000, `${ttl / 60000} min`);

// One check-in at a time (FR2.2)
const ci2 = await call('/api/waiting', {
  method: 'POST',
  token: S,
  body: { stopId: stops.body[0].id },
});
check('second check-in created', ci2.status === 201);
mine = await call('/api/waiting/me', { token: S });
check('only the newest is active (FR2.2)', mine.body?.stopId === stops.body[0].id,
  mine.body?.stopId);

const demand = await call('/api/waiting/demand', { token: D1 });
check('demand has a row per stop', demand.body?.length === 9, demand.body?.length);
const row = demand.body.find((r) => r.stopId === stops.body[0].id);
check('count reflects check-in', row?.waitingCount === 1, row?.waitingCount);
check('oldestCheckInAt ISO', isIso(row?.oldestCheckInAt));
const empty = demand.body.find((r) => r.stopId === stops.body[7].id);
check('replaced stop back to zero', empty?.waitingCount === 0, empty?.waitingCount);
check('zero row has null oldest', empty?.oldestCheckInAt === null);

const cleared = await call(`/api/waiting/demand/${stops.body[0].id}/clear`, {
  method: 'POST',
  token: D1,
});
check('bulk clear → 200', cleared.status === 200);
mine = await call('/api/waiting/me', { token: S });
check('student check-in gone after clear', mine.body === null);

console.log('\n=== ride requests ===');
const tomorrow = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
const created = await call('/api/requests', {
  method: 'POST',
  token: S,
  body: {
    destination: 'Walmart Supercenter',
    pickupStopId: stops.body[7].id,
    pickupLabel: 'ignored, server builds it',
    requestedAt: tomorrow,
  },
});
check('create request → 201', created.status === 201, JSON.stringify(created.body));
check('reference assigned', /^RR-\d+$/.test(created.body?.reference ?? ''), created.body?.reference);
check('status open', created.body?.status === 'open');
check('schedule null initially', created.body?.schedule === null);
check('pickupLabel built server-side',
  created.body?.pickupLabel?.includes('Hilton'), created.body?.pickupLabel);

const past = await call('/api/requests', {
  method: 'POST',
  token: S,
  body: {
    destination: 'Past trip',
    pickupStopId: stops.body[0].id,
    requestedAt: new Date(Date.now() - 3600_000).toISOString(),
  },
});
check('past date rejected', past.status === 422 && past.body?.fields?.requestedAt,
  JSON.stringify(past.body));

const queue = await call('/api/requests/queue', { token: D1 });
check('queue visible to driver', queue.status === 200);
check('queue has the request', queue.body?.some((q) => q.id === created.body.id));
const entry = queue.body.find((q) => q.id === created.body.id);
check('studentName denormalised', entry?.studentName === 'Test Student', entry?.studentName);

console.log('\n=== atomic claim (FR3.4) ===');
const [claimA, claimB] = await Promise.all([
  call(`/api/requests/${created.body.id}/claim`, { method: 'POST', token: D1 }),
  call(`/api/requests/${created.body.id}/claim`, { method: 'POST', token: D2 }),
]);
const statuses = [claimA.status, claimB.status].sort();
check('exactly one winner', statuses[0] === 200 && statuses[1] === 409,
  `${claimA.status}/${claimB.status}`);
const loser = claimA.status === 409 ? claimA : claimB;
check('loser gets claim_conflict', loser.body?.code === 'claim_conflict', loser.body?.code);

const winnerToken = claimA.status === 200 ? D1 : D2;
const queueAfter = await call('/api/requests/queue', { token: D2 });
check('claimed request left the queue (FR3.5)',
  !queueAfter.body.some((q) => q.id === created.body.id));

console.log('\n=== schedule + email ===');
const scheduled = await call(`/api/requests/${created.body.id}/schedule`, {
  method: 'POST',
  token: winnerToken,
  body: { tripAt: tomorrow },
});
check('schedule → 201', scheduled.status === 201, JSON.stringify(scheduled.body));
check('tripAt ISO', isIso(scheduled.body?.tripAt));
check('emailStatus present',
  ['pending', 'sent', 'failed'].includes(scheduled.body?.emailStatus),
  scheduled.body?.emailStatus);
check('failed send leaves sentAt null',
  scheduled.body?.emailStatus !== 'failed' || scheduled.body?.sentAt === null);
console.log(`       emailStatus=${scheduled.body?.emailStatus} (no RESEND_API_KEY set)`);

const wrongDriver = winnerToken === D1 ? D2 : D1;
const notMine = await call(`/api/requests/${created.body.id}/schedule`, {
  method: 'POST',
  token: wrongDriver,
  body: { tripAt: tomorrow },
});
check('other driver cannot schedule', notMine.status === 403, notMine.status);

const resend = await call(`/api/schedules/${scheduled.body.id}/resend`, {
  method: 'POST',
  token: winnerToken,
});
check('resend endpoint reachable', resend.status === 200, JSON.stringify(resend.body));

const trips = await call('/api/requests/mine', { token: S });
check('student sees own requests', trips.status === 200);
const trip = trips.body.find((t) => t.id === created.body.id);
check('status scheduled', trip?.status === 'scheduled', trip?.status);
check('schedule attached', trip?.schedule !== null);

console.log('\n=== authorisation ===');
const noToken = await call('/api/waiting/demand');
check('unauthenticated → 401', noToken.status === 401 && noToken.body?.code === 'unauthorized');
const studentOnBoard = await call('/api/waiting/demand', { token: S });
check('student blocked from board → 403', studentOnBoard.body?.code === 'forbidden');
const driverCheckIn = await call('/api/waiting', {
  method: 'POST', token: D1, body: { stopId: stops.body[0].id },
});
check('driver blocked from check-in → 403', driverCheckIn.body?.code === 'forbidden');
const missing = await call('/api/nope');
check('unknown route → not_found json', missing.body?.code === 'not_found');

console.log('\n=== cleanup: back off duty ===');
const offDuty = await call(`/api/buses/${busId}/duty`, {
  method: 'POST', token: D1, body: { onDuty: false },
});
check('off duty → 200', offDuty.status === 200);
check('position cleared', offDuty.body?.position === null);
check('nextStopId cleared', offDuty.body?.nextStopId === null);

const pingOff = await call(`/api/buses/${busId}/ping`, {
  method: 'POST', token: D1, body: { lat: 35.67, lng: -80.48 },
});
check('ping rejected while off duty', pingOff.status === 403, pingOff.status);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
