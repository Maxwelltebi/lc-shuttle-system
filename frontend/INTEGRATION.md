# Backend integration guide

Everything the Express + Mongo backend has to provide for this React
frontend to work.

**The authoritative contract is [`shared/types.ts`](../shared/types.ts).**
Both the frontend and the backend import that one file, so a shape
cannot drift between them: change it and whichever side disagrees stops
compiling. `src/types/index.ts` simply re-exports it.
This document explains it; that file enforces it. If an endpoint returns
a different shape, the build fails rather than the UI breaking in front
of a student at a bus stop.

---

## How to connect it

The frontend talks to the API through exactly one function —
`request()` in [`src/api/client.ts`](src/api/client.ts).

```bash
# frontend/.env.local
VITE_API_URL=http://localhost:4000
```

That one variable is the whole switch. With it unset, every call returns
its `fallback` value and the app renders its empty states — no mock data
anywhere, just nothing yet.

Auth token: the frontend calls `setAuthToken(token)` after sign-in and
sends `Authorization: Bearer <token>` on every subsequent request.

---

## Endpoints

Paths are what the frontend already calls. Response shapes reference the
types in `shared/types.ts`.

### Auth

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/auth/signin` | `{ email, password, role }` | `AuthSession` |
| POST | `/api/auth/signup/student` | `SignUpInput` | `AuthSession` |
| POST | `/api/auth/signup/driver` | `SignUpInput` | `{ pending: true }` |
| POST | `/api/auth/signout` | — | `null` |
| GET | `/api/auth/me` | — | `CurrentUser` |

**`role` is sent on sign-in deliberately.** Reject a student signing in
on the Driver tab rather than silently landing them in the wrong app.

**Driver signup returns no session.** Drivers cannot enter until staff
approve them — return `403` with code `not_approved` if they try to sign
in first. Without this, anyone with a school email could broadcast fake
bus positions.

### Route

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/stops` | `Stop[]` |

Seeded by `backend/src/seed.ts` — real published data from the shuttle
flyer, not fixtures. The frontend keeps the same nine stops in
[`src/config/stops.ts`](src/config/stops.ts) as an offline fallback for
when no backend is configured.

> `offsetMinutes` in the seed (how long after departure the loop reaches
> each stop) are **estimates** spread evenly across the 55-minute loop.
> They are the one piece of invented data in the system and they drive
> every ETA. Replace them by riding one loop with a stopwatch.

### Live tracking — Module 1

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/buses` | — | `Bus[]` |
| GET | `/api/service-status` | — | `ServiceStatus` |
| GET | `/api/buses/:id/arrivals` | — | `StopArrival[]` |
| POST | `/api/buses/:id/duty` | `{ onDuty }` | `Bus` |
| POST | `/api/buses/:id/next-stop` | `{ stopId }` | `Bus` |
| POST | `/api/buses/:id/ping` | `{ lat, lng, accuracyMeters }` | `null` |

### Waiting check-ins — Module 2

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/waiting/me` | — | `WaitingCheckIn \| null` |
| POST | `/api/waiting` | `{ stopId }` | `WaitingCheckIn` |
| DELETE | `/api/waiting/:id` | — | `null` |
| GET | `/api/waiting/demand` | — | `StopDemand[]` |
| POST | `/api/waiting/demand/:stopId/clear` | — | `StopDemand` |

### Ride requests — Module 3

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/requests/mine` | — | `RideRequest[]` |
| POST | `/api/requests` | `CreateRequestInput` | `RideRequest` |
| GET | `/api/requests/queue` | — | `QueueEntry[]` |
| POST | `/api/requests/:id/claim` | — | `RideRequest` |
| POST | `/api/requests/:id/schedule` | `{ tripAt }` | `RideSchedule` |
| POST | `/api/schedules/:id/resend` | — | `RideSchedule` |

`/queue` returns open requests **plus** anything the requesting driver
has claimed but not yet scheduled. Open-only would make a request vanish
the moment it was claimed — off the open list correctly, but with nowhere
else to appear, so a refresh loses the trip. The other driver still
cannot see it, which is what FR3.5 requires.

---

## Five rules the backend must enforce

These are the places a MERN implementation usually goes wrong. The
frontend assumes all five.

### 1. Claiming must be atomic

Two drivers tapping Claim at the same instant must produce exactly one
winner. Do it in one conditional update, never read-then-write:

```js
const claimed = await RideRequest.findOneAndUpdate(
  { _id: id, status: 'open' },      // the guard is the whole point
  { status: 'claimed', claimedBy: driverId, claimedAt: new Date() },
  { new: true },
);
if (!claimed) {
  return res.status(409).json({
    code: 'claim_conflict',
    message: 'The other driver claimed this one first.',
  });
}
```

The frontend renders a specific "Already claimed" notice on
`claim_conflict`. Any other error code shows a generic failure instead.

### 2. Check-in expiry is applied at read time

A check-in older than 90 minutes counts as expired the moment anyone
reads it. Do not rely on a cron job — filter in the query:

```js
const cutoff = new Date(Date.now() - 90 * 60 * 1000);
WaitingCheckIn.find({ status: 'waiting', createdAt: { $gte: cutoff } });
```

Return `expiresAt` on every check-in. The UI renders "clears
automatically at 3:34 PM" from that field rather than computing it, so
the countdown can never disagree with the server.

### 3. One active check-in per student

Checking in at a new stop replaces the old one. Do it server-side in one
operation — a client that deletes then creates can leave a student
checked in twice if the second call fails.

### 4. Service hours are server-owned

`GET /api/service-status` returns whether anything is running, the next
departure, and a human-readable message the UI prints verbatim.

Do not compute this in the browser. A phone with a wrong clock would
tell a student "next departure 1:15 PM" twenty minutes late, and they
would miss the bus.

### 5. Email failure must be visible

`RideSchedule.emailStatus` is `'pending' | 'sent' | 'failed'`, and
`sentAt` is null until delivery succeeds. When Resend fails, save the
schedule and return `emailStatus: 'failed'` — do not throw. The driver
sees a "Schedule saved, email not delivered" notice with a Resend
button, because a schedule the student never receives is the same as no
schedule.

> Note the known limitation from the README: on Resend's free onboarding
> domain, mail only delivers to the account owner's own address. Until a
> domain is verified, `emailStatus: 'failed'` is the expected result for
> real students.

---

## Route order, and why `sequence` matters

Stops carry `sequence` (1–9), their position in the one-way loop. Two
things depend on it:

**The driver's board renders in route order** — the order they will
physically arrive, not alphabetical and not by count.

**Arrival order is not stop order.** After stop 9 the bus wraps to stop
1. A bus heading to stop 4 reaches stops in the order 4, 5, 6, 7, 8, 9,
1, 2, 3 — so ETAs must ascend along *that* sequence. The frontend
already rotates the list this way in `MapScreen`; make sure the ETA
values agree, or stops 1–3 will show times earlier than stop 9.

---

## What the frontend computes vs. what the server must send

Getting this line wrong is the most common source of two-sources-of-truth
bugs.

| Computed in the browser | Must come from the server |
| --- | --- |
| Relative times ("14 min ago") | All absolute timestamps |
| Date/time inputs → one ISO string | `expiresAt`, `scheduledClock` |
| Arrival-order rotation of the stop list | `etaMinutes`, `scheduleOffsetMinutes` |
| Which nav badge to show | `waitingCount`, `oldestCheckInAt` |
| Empty/loading/error presentation | `ServiceStatus`, `BusStatus` |

The rule: the browser formats, the server decides.

---

## Polling

There are no WebSockets. `usePolling` ([`src/hooks/usePolling.ts`](src/hooks/usePolling.ts))
is the only place live behaviour lives.

| Screen | Call | Interval |
| --- | --- | --- |
| Student map | `fetchBuses` | 10s |
| Student map | `fetchServiceStatus` | 60s |
| Driver board | `fetchDemand` | 10s |
| Driver queue | `fetchQueue` | 10s |
| My requests | `fetchMyRequests` | 30s |

Polling pauses while the tab is hidden — a phone in a pocket should not
burn battery asking where the bus is.

At ~100 concurrent students this is roughly 20 requests/second. If you
ever move to WebSockets, rewrite this one hook; no screen knows how its
data arrives.

---

## Styling

`src/tokens/tokens.css` holds every colour, size, radius and shadow.
Values were **sampled from the pixels** of the design PNGs, not matched
by eye.

| Token | Value | Used for |
| --- | --- | --- |
| `--ground` | `#f8f6f2` | app background |
| `--surface` | `#ffffff` | cards, inputs |
| `--surface-inverse` | `#0f1825` | dark panels, GPS block |
| `--ink` | `#1a2744` | headings, primary buttons |
| `--accent` | `#c4852a` | Claim, I'm waiting here, NEXT |
| `--live` | `#3a9e70` | on duty, LIVE, active check-in |
| `--danger` | `#c03530` | cancel check-in |
| `--line` | `#eeebe6` | borders |

Components use CSS Modules (`Button.module.css` etc.), so class names are
scoped and safe to change. Breakpoint is **900px**: below it the bottom
tab bar, above it the sidebar.

Typeface is a system stack led by SF Pro. The exact font in the designs
could not be extracted from PNGs — swap `--font-sans` if you know it.

---

## States built without a design

These are required by the spec but absent from the design files. Built
from the same tokens so they belong visually, and listed here so they
can be redesigned properly and swapped in.

| State | Where | Why it exists |
| --- | --- | --- |
| Lost claim race | Queue | FR3.4 — the losing driver must be told |
| Email send failure | Queue | A schedule nobody received is not a success |
| Post-send confirmation | Queue | The design ended at the button |
| Loading / error | Every screen | Requests fail |
| Off-duty warning | Board | A driver invisible to students would not otherwise know |
| Driver pending approval | Sign-up | Staff approval has no other surface |
| No bus assigned | On duty | A driver can exist before staff assign a bus |

Two further gaps worth noting: **the schedule email itself has no
design**, and it is the only thing the student actually receives. And
the mobile no-service state was a duplicate export, so it was derived
from the desktop version.

---

## Verifying it

```bash
cd backend
npm run test      # 76 assertions against a running API
```

This exercises every endpoint and asserts the response shapes, including
the cases most likely to be wrong: simultaneous claims resolving to one
winner, ETAs ascending in loop order rather than stop order, the
90-minute TTL, one check-in per student, and a failed email surfacing as
`emailStatus: 'failed'` rather than being swallowed.

Requires the API running and the database seeded.

---

## Running it

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
npm run build   # typechecks, then builds
```

With no `VITE_API_URL`, every screen renders empty. That is correct —
it is what the app looks like before a driver goes on duty and before
any student checks in.
