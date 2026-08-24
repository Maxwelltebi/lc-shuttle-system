# LC Shuttle

A shuttle tracking app for **Livingstone College**, Salisbury, North Carolina.

**Timeline:** 1 week
**Contributors:** Maxwell Tebi, Isaac Abakah

---

## The problem

A student lives at one of the hotel properties the college uses for housing, a couple of miles from campus. They need to get to class. They walk outside and stand there — no idea where the shuttle is, whether it just left, or whether it is coming in five minutes or forty. So they wait, and sometimes they miss class.

A printed timetable exists, but the college's own flyer says the quiet part out loud: there is a *"5-minute service window at each stop,"* buses *"may arrive a few minutes before or after the listed time,"* and students should *"plan to arrive at your stop a few minutes early."* A schedule tells you when the bus is **supposed** to come. It cannot tell you where the bus **is**.

The driver has the opposite half of the same problem: no idea anyone is standing at the hotel at all.

**Students can't see the shuttles, and drivers can't see the students. This app makes both visible.**

---

## The flow in 5 steps

1. Student opens the app and lands on a map showing both buses, where each is headed, and minutes until arrival.
2. Student taps **"I'm waiting"** and picks their stop.
3. Driver sees a live board: *Hotel — 5 waiting*, and drives there.
4. Driver picks everyone up and taps **"Clear all"** on that stop, wiping the board clean.
5. Separately, for off-route trips (Walmart, airport), a student submits a request, either driver claims it and sets a time, and the student gets an email.

---

## Screens

Three screens per role. That is the whole app.

### Student

| Screen | What it does |
| --- | --- |
| **Map (home)** | Opens straight to the map. Bus pins, all nine stops, your own location. One line per bus: *"Bus 1 → Lloyd Street · 6 min away."* Outside service hours it shows *"No service — next departure 1:15 PM."* |
| **I'm waiting** | One button. Pick your stop (defaults to nearest), confirm. A chip appears: *"Waiting at Hotel · Cancel."* It disappears when the driver clears the stop. |
| **Request a ride** | Form: destination, pickup, date/time. Submit. Email arrives when a driver claims it. No map, no tracking. |

### Driver

| Screen | What it does |
| --- | --- |
| **On duty** | Toggle. On = phone broadcasts GPS. Off = invisible to students. Plus a next-stop selector listing the nine stops in route order — this is what students see as "where it's going." |
| **Waiting board (home)** | Nine stop cards **in route order**, each with a live count and a **Clear all** button. The main screen a driver looks at. |
| **Request queue** | Open requests, oldest first. Tap → Claim → set date/time → Send. |

---

## Map and coordinates

**Provider: Leaflet + OpenStreetMap.** Not Google Maps — Google requires an API key tied to a billing account, and a key exposed in frontend code can be abused. Leaflet is free, needs no key, and is sufficient for pins on a map.

The route spans roughly 2.5 miles north-to-south across Salisbury, from College Park Residence Hall in the north to the Hilton property in the south, and about 1.8 miles east-to-west. The map must cover all nine stops:

```js
center: [35.6600, -80.4779]
zoom:   13
maxBounds: [[35.635, -80.500], [35.685, -80.455]]
```

> Earlier bounds (drawn for a two-stop route) cut off the Marriott, Wyndham and College Park stops. Recompute whenever the route changes.

### What counts as a stop

A stop is **where the bus pulls over, not where a student lives.** Students live in different places across Salisbury; the shuttle cannot drive to every door. The stop list therefore covers the main clusters — the housing points where students gather and the campus destinations they travel to — and students walk to their nearest one.

Anyone living somewhere the shuttle does not serve uses Module 3 (special ride requests) instead. Fixed stops cover the common case; the request queue covers everyone else.

The route currently has nine stops. Nothing is hardcoded to that number — adding or removing a stop is a row change, and the driver's board simply shows more or fewer cards.

### Route and stops

Source: the official **Livingstone College Academic Shuttle** flyer (Division of Student Affairs). The route is a fixed one-way loop that departs Horseshoe Gate, runs the stops in order, and returns to Horseshoe Gate.

| # | Stop | Address | Lat | Lng |
| --- | --- | --- | --- | --- |
| 1 | Horseshoe Gate / Main Campus | 701 W Monroe St | 35.6712869 | -80.4856795 |
| 2 | Monroe Street Campus Housing | 1312 Monroe St | 35.6746013 | -80.4869087 |
| 3 | College Park Residence Hall | 1710 Old Wilkesboro Rd | 35.6781554 | -80.4933678 |
| 4 | Lloyd Street Campus Housing | 301 Lloyd St | 35.6742700 | -80.4826620 |
| 5 | Hood Theological Seminary | 1810 Lutheran Synod Dr | 35.6438755 | -80.4830930 |
| 6 | Courtyard by Marriott | 120 Marriott Circle | 35.6581116 | -80.4623623 |
| 7 | Wyndham Property | 925 Bendix Dr | 35.6502567 | -80.4690925 |
| 8 | Hilton Property | 1001 Klumac Rd | 35.6423344 | -80.4849527 |
| 9 | Culinary Arts Facility (final stop) | 530 Jake Alexander Blvd S | 35.6465169 | -80.4884965 |

Coordinates geocoded from OpenStreetMap, accurate to the building. OSM independently confirms the identities: stop 6 is Courtyard by Marriott Salisbury, stop 7 is Super 8 by Wyndham, stop 8 is a Hampton (Hilton brand), and stop 9 is the Hotel Salisbury & Conference Center building.

**Campus drop-off** is available after the Lloyd Street stop (between stops 4 and 5).

**Three of the stops are hotels used as student housing** — Marriott, Wyndham and Hilton. "The hotel" is not one place; students are spread across several properties, which is exactly why the app must be stop-agnostic.

### Route order matters

`STOP` carries a `sequence` column (1–9). Two things depend on it:

- The driver's waiting board lists stops **in route order**, so the driver reads it in the order they will physically arrive.
- ETA follows the loop, not straight-line distance. A bus at stop 5 reaches stop 7 *after* passing stop 6, even if stop 7 is geographically closer.

### Service hours

Departures leave Horseshoe Gate hourly:

| Morning | Afternoon / Evening |
| --- | --- |
| 7:15, 8:15, 9:15, 10:15, 11:15 AM | 1:15, 2:15, 3:15, 4:15, 5:15, 6:15, 7:15 PM |

**Driver lunch break 12:15–1:15 PM — no regular service.** Final service ends **8:10 PM**.

A full loop therefore takes about **55 minutes** (7:15 PM departure, 8:10 PM finish) across nine stops — roughly 6 minutes between stops.

The app must know these hours. Outside them, and during the lunch break, the student map shows **"No service — next departure 1:15 PM"** rather than an empty map or a stale ETA. This is a new requirement the two-stop draft did not have.

The lunch break is also the natural window for Module 3 special rides, since the drivers are off the loop.

### ETA calculation

The published timetable makes this better than a pure distance guess. Two inputs combine:

**1. The schedule backbone.** The loop is fixed and hourly, so each stop has a known offset from the 15-past departure (stop 1 = 0 min, stop 9 ≈ 48 min). That alone gives a baseline arrival time with no GPS at all — and it still works when a driver's phone dies.

> **To measure:** ride one full loop and record the arrival time at each stop. That produces the nine offsets, and is the single most valuable hour of fieldwork on this project.

**2. The live offset.** Compare the bus's actual position against where the schedule says it should be, and shift every downstream ETA by that difference. If the bus is 7 minutes behind at stop 4, every later stop is roughly 7 minutes late.

This is why the app beats the flyer: the timetable says 2:15, the app says *"running 7 minutes late, arriving 2:22."*

**Fallback:** until the per-stop offsets are measured, use straight-line distance along the remaining loop × 1.4, divided by 25 mph. Rough but usable; replace it once the real numbers exist.

### Live updates: polling, not WebSockets

There are two one-way flows, not a shared map. The driver broadcasts and never reads a map; the student reads the map and never broadcasts. They meet only at the server.

| Flow | Sender | Receiver | Interval |
| --- | --- | --- | --- |
| GPS location | Driver's phone, while on duty | All student maps | POST every 10s |
| Waiting check-ins | Students, on tap | Both drivers' boards | GET every 10s |

**v1 uses HTTP polling on a timer, not WebSockets.** WebSockets are technically superior — true push, lower latency, better at thousands of connections — but the gain is invisible here. A bus at 25 mph moves about 180 feet in 5 seconds; no one waiting at a stop can tell a pushed update from a polled one. Meanwhile sockets drop constantly on phones (screen lock, building walls, wifi-to-cellular handoff), so they demand reconnect logic, backoff, heartbeats, and state resync — a real slice of a one-week budget. Polling requests are independent: a failed one simply succeeds 5 seconds later. Polling also runs on any host, while persistent connections need one that supports them.

At ~100 concurrent students, polling is roughly 20 requests per second — a small load for reading two rows and returning coordinates.

**Keep the upgrade path open:** all data fetching goes behind a single function (`getBusPositions()`). Screens call that and know nothing about where the data came from. Swapping in WebSockets later means changing that one function, not the app. Revisit only at several hundred concurrent users or a genuine sub-second requirement — neither applies to two buses at Livingstone.

---

## Modules

### Module 1 — Live shuttle tracking

There are exactly two buses on campus, and both are always shown simultaneously on every student's map — no per-student route filtering.

Each driver's device broadcasts its GPS location at regular intervals while on duty. Students see, per bus: current position, current destination, and an ETA to each stop.

No boarding confirmation and no automated route optimization in v1. This module is purely *where is it, where's it going, when will it arrive.*

### Module 2 — Waiting requests (demand visibility)

A student at a stop taps a button to signal "I'm waiting" there. This is visible to both drivers at all times, whether or not a driver is on an active trip — a standing, always-live board, not tied to a specific trip.

A student may withdraw their waiting status at any time. A student may hold only one active check-in at a time; checking in at a new stop replaces the previous one.

**Clearing on pickup:** rather than auto-detecting boarding via GPS or geofencing — rejected as unreliable given campus network conditions and the tuning burden of proximity/dwell logic — the driver clears manually. One tap clears every active check-in at that location at once, never one student at a time.

**Safety net:** if neither the student withdraws nor a driver clears it, a check-in expires automatically after 1 hour 30 minutes, so stale entries don't accumulate.

### Module 3 — Special ride requests

For ad-hoc destinations outside the regular routes — Walmart, a shop, the airport for a conference. Deliberately simple: no live tracking, no map, no GPS.

A student submits destination, pickup location, and requested date/time. Both drivers see all open requests in a shared queue, oldest first.

Any driver may claim any request at their own discretion. There is no assignment logic — a driver picks what fits their schedule that day. Claiming removes the request from the open queue immediately, so no other driver can act on it.

The claiming driver then submits a schedule (date, time, destination, pickup location), which is emailed to the student.

**Stuck claims:** if a driver claims a request but does not submit a schedule within 12 hours, the claim is released and the request returns to the open queue. This prevents a request being silently trapped where the other driver cannot reach it.

**Auto-expiry:** if a request's requested date/time passes with no driver having claimed it, it expires and drops out of the queue silently. No reassignment, no notification — it simply means no driver was able to take it.

**Concurrency:** claiming must be atomic. If two drivers tap claim at the same moment, only one succeeds. Implemented as a conditional update (`UPDATE ride_request SET status='claimed', claimed_by=? WHERE id=? AND status='open'`) — if zero rows are affected, that driver lost the race and sees "already claimed."

---

## Data model

### STOP
```
id (PK)
name              -- "Horseshoe Gate / Main Campus", …
address
lat
lng
sequence          -- 1–9, position in the one-way loop; drives board order and ETA
```

### STUDENT
```
id (PK)
name
email             -- school email, also the login
password_hash
```

### DRIVER
```
id (PK)
name
email
password_hash
```

### BUS
```
id (PK)
label             -- "Bus 1"
driver_id (FK)    -- fixed 1:1; two buses, two dedicated drivers, no driver pool
on_duty (bool)
current_lat
current_lng
current_destination_stop_id (FK to STOP, nullable)
last_ping_at      -- if older than 2 minutes, the bus renders greyed out as "offline"
```
> Driver-to-bus is held on this side only. The reverse `DRIVER.bus_id` was removed — two FKs pointing at each other can drift out of sync.

### WAITINGCHECKIN
```
id (PK)
student_id (FK)
stop_id (FK)
status            -- waiting / withdrawn / picked_up / expired
created_at
cleared_by (FK to driver, nullable)
cleared_at (nullable)
```
> TTL is 1h30m from `created_at`, enforced **at read time** — a check-in older than that is treated as expired when the board is queried. No background job needed.
> Constraint: at most one row per student with `status = waiting`.

### RIDEREQUEST
```
id (PK)
student_id (FK)
destination
pickup_location
requested_at      -- single timestamp, not separate date/time fields
status            -- open / claimed / scheduled / expired
claimed_by (FK to driver, nullable)
claimed_at (nullable)   -- used for the 12-hour stuck-claim release
created_at
```

### RIDESCHEDULE
```
id (PK)
ride_request_id (FK)
driver_id (FK)
trip_at           -- single timestamp
destination
pickup_location
sent_at           -- when the email was sent; null means send failed and needs retry
```

---

## State flows

**WaitingCheckIn**
```
waiting → withdrawn   (student cancels)
waiting → picked_up   (driver bulk-clears the location)
waiting → expired     (1h30m TTL passes untouched)
```

**RideRequest**
```
open → claimed → scheduled   (driver claims, then submits a schedule; the claim must be atomic)
claimed → open               (no schedule submitted within 12 hours; claim released)
open → expired               (requested date/time passes with no claim)
```

---

## Functional requirements

### Module 1 — Live tracking

- **FR1.1** — The system shall broadcast each bus's live GPS location at regular intervals from the driver's device while that driver is on duty.
- **FR1.2** — The student app shall display both buses simultaneously on a live map.
- **FR1.3** — The system shall display each bus's current destination.
- **FR1.4** — The system shall compute and display an ETA from each bus to each stop.
- **FR1.5** — A bus whose last ping is older than 2 minutes shall be shown as offline rather than at a stale position.
- **FR1.6** — The system shall display ETAs relative to the published timetable, indicating how early or late the bus is running.
- **FR1.7** — Outside service hours (before 7:15 AM, after 8:10 PM) and during the 12:15–1:15 PM driver lunch break, the system shall show a no-service state naming the next departure time.

### Module 2 — Waiting requests

- **FR2.1** — A student shall be able to submit a waiting check-in at one of the defined stops.
- **FR2.2** — A student shall hold at most one active check-in; a new check-in replaces any existing one.
- **FR2.3** — A student shall be able to withdraw their own active check-in at any time.
- **FR2.4** — Both drivers shall see waiting check-ins across all stops in real time, regardless of trip status.
- **FR2.5** — A driver shall be able to clear all active check-ins at a given stop with a single action.
- **FR2.6** — The system shall treat a check-in as expired 1 hour 30 minutes after creation if not withdrawn or cleared.

### Module 3 — Special ride requests

- **FR3.1** — A student shall be able to submit a special ride request specifying destination, pickup location, and requested date/time.
- **FR3.2** — Both drivers shall see all open requests, ordered by submission time.
- **FR3.3** — Any driver shall be able to claim an open request at their own discretion.
- **FR3.4** — Claim actions shall be atomic; if two drivers claim simultaneously, only one shall succeed and the other shall be told it is already claimed.
- **FR3.5** — Claiming shall remove the request from the open queue immediately.
- **FR3.6** — The claiming driver shall be able to submit a schedule tied to that request.
- **FR3.7** — The system shall email the finalized schedule to the requesting student, and shall record whether that send succeeded.
- **FR3.8** — A claimed request with no schedule submitted within 12 hours shall return to the open queue.
- **FR3.9** — A request whose requested date/time passes without being claimed shall expire silently, with no reassignment.

---

## Email delivery

**Provider: Resend**, using the free `onboarding@resend.dev` sender.

> **Known limitation.** On the free onboarding domain, Resend only delivers to the account owner's own email address. Mail to an actual student will fail until a domain is verified. FR3.7 therefore does **not** work for real students in the demo build.
>
> The fix is to verify a domain (add Resend's DNS records — about 15 minutes plus propagation). Using the college domain is the correct long-term answer but needs Livingstone IT, which is likely slower than this week.
>
> **v1 plan:** demo the email by sending to our own addresses, proving the flow works, and treat domain verification as the single step between this and production.

Sending through a personal Gmail account with an app password was rejected: it works in testing, then hits sending limits and lands in spam — and a schedule email the student never sees is the same as no email at all.

---

## Design principles and key decisions

**Modularity.** The three modules are intentionally decoupled. None depends on another to function, so each can be built, tested, and shipped independently — which matters with two contributors and one week.

**No GPS auto-detection of boarding.** Rejected in favour of a manual driver clear plus a TTL safety net, avoiding proximity and dwell-time tuning and any dependence on continuous accurate GPS.

**No route optimization in v1.** The waiting board gives drivers visibility; route decisions stay manual and driver-discretion-based.

**Fixed 1:1 driver-to-bus.** Two drivers, two buses, no dynamic pool. The same two drivers handle special ride requests in the gaps of their schedules.

**Silent expiry over reassignment.** Both check-ins and ride requests expire quietly rather than triggering escalation or notification logic.

**Bulk over granular clearing.** The clear action works per stop, not per student, matching how a driver actually experiences arriving at a stop.

**Approximate ETAs are acceptable.** Precision is not the goal; replacing total ignorance with a usable estimate is.

**The schedule is the backbone, GPS is the correction.** A published hourly timetable already exists. The app's job is not to replace it but to say how far off it is running today — and it degrades gracefully to the plain timetable if a driver's phone goes offline.

---

## Work split

Two people, one week, three deliberately independent modules — so they can be built in parallel, but not from minute one.

**Day 1, together:** database, login, and the stops table. Both modules sit on this foundation; splitting before it exists means building two versions of it and losing a day to merging.

**Then split**, balanced by difficulty rather than count:

| Who | Scope |
| --- | --- |
| One contributor | Module 1 — live tracking (GPS, map, ETA math, polling loop). The hardest of the three. |
| Other contributor | Modules 2 and 3 — waiting board and ride requests. Both are more straightforward CRUD. |

---

## Open questions

1. **Do the two buses stagger?** Confirmed: two shuttles run the loop. The flyer lists one hourly departure column, so either both leave Horseshoe Gate together at :15 (capacity), or they run offset (e.g. :15 and :45, giving 30-minute headways). This only affects the ETA baseline, not the build — GPS shows the truth either way.
2. **Per-stop timing offsets** — ride one full loop and record arrival times at all nine stops. Needed for schedule-based ETAs.
3. **Does the route vary by day or time?** The flyer shows one weekday schedule; weekend and holiday service is unspecified.
4. **Where does campus drop-off physically happen?** The flyer offers it after Lloyd Street but gives no address — it may need to be a tenth stop.

**Contact for all of the above:** Division of Student Affairs — 704-216-6185, mrush@livingstone.edu
