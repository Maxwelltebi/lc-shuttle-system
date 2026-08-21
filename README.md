This is the repository for the LC Shuttle project to be completed in 1 week. 


Contributors:
Maxwell Tebi
Isaac Abakah

* AN UPDATE TO ALL CONTRIBUTORS *

** Below is a draft of the scope of the project. You will also find Project Functional requirements split into Modules**
Module 1 — Live shuttle tracking
There are exactly two buses on campus. 

Both buses are always shown simultaneously on the student's live map — no per-student route filtering.

Each driver's device broadcasts the bus's live GPS location at regular intervals.

Students see, per bus: current position on a map, current destination, and an estimated time of arrival (ETA) to their relevant stop.

No boarding/alighting confirmation and no automated route optimization in v1 — this module is purely "where is it, where's it going, when will it arrive."


Module 2 — Waiting requests (demand visibility)

A student at a location (hotel / A / B / C) taps a button to signal "I'm waiting" at that location.

This is visible to all drivers, regardless of whether a given driver is currently on an active trip — it is a standing, always-live 
board, not tied to a specific trip.

A student can withdraw their waiting status manually at any time.
Clearing on boarding: rather than trying to auto-detect boarding (e.g. via GPS/geofencing — rejected as unreliable given campus network conditions and the added complexity of tuning proximity/dwell logic), the driver clears it manually:

The driver performs a single bulk-clear action per location — one tap clears every active waiting check-in at that location at once (not one-by-one per student).

Safety net: if neither the student withdraws nor the driver clears it, a waiting check-in automatically expires after 1 hour 30 minutes, so stale entries don't accumulate indefinitely.


Module 3 — Special ride requests

For ad-hoc destinations outside the regular shuttle routes (Walmart, a shop, the airport for a conference, etc.).

Deliberately simple: no live tracking, no map, no GPS for this feature.

A student submits a request specifying: destination, pickup location, and requested date/time.

Both drivers see all open requests in a shared queue, in the order they were submitted.

Any driver may claim any request at their own discretion — there is no assignment logic; a driver picks based on what fits their personal schedule for that day. If a driver doesn't touch a request, it stays visible and available for the other driver.

Once a driver claims a request, they respond with a schedule: date, time, destination (e.g. "campus to Walmart" or "hotel to airport"), and pickup location. This schedule is emailed to the student.

Once scheduled, the request is removed from the open queue — no other driver can act on it.

Auto-expiry: if a request's requested date/time passes with no driver having claimed it, the request automatically expires and drops out of the queue silently. No reassignment or notification logic — it simply means no driver was able to take it.

Concurrency requirement: claiming must be atomic. If two drivers attempt to claim the same request at the same moment, only one claim can succeed — this prevents two drivers showing up for the same student.


Sample Data model descriptions
Data model / entities

STUDENT

id (PK)
name
email

DRIVER

id (PK)
name
email
bus_id (FK) — fixed 1:1 with a bus; there are only two buses and two dedicated drivers, no separate driver pool

BUS

id (PK)
label (e.g. "Bus 1")
driver_id (FK)
current_lat
current_lng
current_destination
eta_minutes
last_ping_at (timestamp)

WAITINGCHECKIN

id (PK)
student_id (FK)
location (Hotel / Location A / Location B / Location C)
status: waiting / withdrawn / picked_up / expired
created_at
cleared_by (FK to driver, nullable)
cleared_at (nullable)
TTL: 1 hour 30 minutes from created_at (checked at read-time or via background job)

RIDEREQUEST

id (PK)
student_id (FK)
destination
pickup_location
requested_date
requested_time
status: open / claimed / scheduled / expired
claimed_by (FK to driver, nullable)
created_at

RIDESCHEDULE

id (PK)
ride_request_id (FK)
driver_id (FK)
trip_date
trip_time
destination
pickup_location
sent_at (timestamp the email was sent)
6. State flows

WaitingCheckIn

waiting → withdrawn (student cancels)
waiting → picked_up (driver bulk-clears the location)
waiting → expired (1h30m TTL passes untouched)

RideRequest

open → claimed → scheduled (a driver claims it, then submits a schedule; the claim step must be atomic)
open → expired (requested date/time passes with no claim)

FUNCTIONAL REQUIREMENTS
Functional requirements

Module 1 — Live tracking

FR1.1: The system shall broadcast each bus's live GPS location at regular intervals from the driver's device.

FR1.2: The student app shall display both buses simultaneously on a live map.

FR1.3: The system shall display each bus's current destination.

FR1.4: The system shall compute and display an ETA to the student's relevant stop.

Module 2 — Waiting requests

FR2.1: A student shall be able to submit a waiting check-in at one of the defined locations (Hotel, A, B, C).

FR2.2: A student shall be able to withdraw their own active check-in at any time.

FR2.3: All drivers shall see waiting check-ins across all locations in real time, regardless of their current trip status.

FR2.4: A driver shall be able to bulk-clear all active check-ins at a given location with a single action.

FR2.5: The system shall automatically mark a check-in as expired 1 hour 30 minutes after creation if it has not been withdrawn or cleared.

Module 3 — Special ride requests

FR3.1: A student shall be able to submit a special ride request specifying destination, pickup location, and requested date/time.

FR3.2: All drivers shall see all open special ride requests, ordered by submission time.

FR3.3: Any driver shall be able to claim an open request at their own discretion.

FR3.4: Claim actions shall be atomic — if two drivers attempt to claim the same request simultaneously, only one shall succeed.

FR3.5: Once a driver claims a request, they shall be able to submit a schedule (date, time, destination, pickup location) tied to that request.

FR3.6: The system shall email the finalized schedule to the requesting student.

FR3.7: Once scheduled, the request shall be removed from the open queue.

FR3.8: If a request's requested date/time passes without being claimed, the system shall automatically expire it and remove it from the open queue, with no reassignment.


8. Design principles and key decisions

Modularity: the three modules are intentionally decoupled. None depends on another to function, so each can be built, tested, and shipped independently.

No GPS-based auto-detection of boarding: rejected in favor of a manual driver clear action + TTL safety net, avoiding proximity/dwell-time tuning and dependence on continuous, accurate GPS connectivity.

No automated route optimization or demand-based re-routing in v1: the waiting board gives drivers visibility, but route decisions remain manual and driver-discretion-based.

Driver-to-bus assignment is fixed 1:1: two drivers, two buses, no dynamic pool. The same two drivers also handle special ride requests in the gaps of their schedule, entirely at their own discretion.

Silent expiry over reassignment: both waiting check-ins and special ride requests expire silently when their time window passes, rather than triggering escalation, reassignment, or notification logic — keeping v1 simple.

Bulk over granular clearing: the waiting-board clear action operates per location, not per student, matching how a driver naturally experiences a stop.