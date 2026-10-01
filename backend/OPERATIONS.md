# Tracking, transactions, and delivery

The API now requires a MongoDB replica set (including a one-member development
replica set) or a sharded deployment. Standalone MongoDB is deliberately rejected:
check-ins, schedules, and email outbox writes must commit together.

For a fresh local development database, start an installed MongoDB server with
`mongod --replSet rs0 --bind_ip 127.0.0.1 --dbpath <your-development-data-directory>`.
Initialize it once with `mongosh --eval "rs.initiate()"`, then set `MONGO_URL` in
`backend/.env` to `mongodb://127.0.0.1:27017/lc-shuttle?replicaSet=rs0`.
Do not initialize or reconfigure an existing deployment without checking its topology.

## Existing data

Stop the old API and back up the database before applying migrations.
From `backend`, run `npm run migrate` for a read-only duplicate-check-in audit.
Then run `npm run migrate -- --apply` to retain the newest waiting record per
student, mark older waiting records withdrawn, create required indexes, and
initialize the request-reference counter above existing references.

Duplicate schedules or outbox records require operator reconciliation; index
creation fails rather than silently deleting them. Startup verifies transaction
support and indexes before accepting traffic. All older API instances must be
stopped before enabling these constraints.

## Tracking

The driver session owns duty state and GPS capture across page navigation.
GPS updates use socket acknowledgements with HTTP fallback. Every accepted
mutation increments a bus revision and broadcasts after persistence. Student
polling reconciles missed events even when its socket remains connected.
Measurement time orders positions across browser reloads; sequence is retained
only as diagnostic information. Exact retries do not refresh position age.

The browser ages measurements after two minutes. New uploads must contain a
measurement timestamp no older than one minute and no more than ten seconds in
the future. No timestamp-free legacy upload path is supported.

## Email recovery

The worker runs with the API and atomically leases jobs for 60 seconds. Network
sends time out after 20 seconds. Interrupted leases can be reclaimed, and
completion updates both the outbox and schedule in one transaction.
The frozen email payload and stable Resend idempotency key survive retries.

Resend retains idempotency keys for 24 hours:
https://resend.com/docs/dashboard/emails/idempotency-keys
Automatic/manual retries stop after a conservative 23-hour window from the
first attempt. An operator must inspect provider delivery records before
reconciling older uncertain deliveries; exactly-once delivery cannot be promised
across an unlimited provider outage. Do not reset the key or first-attempt time
without checking whether the email was already accepted.

Drivers can inspect their delivery statuses and retry failed jobs from the queue.
`sent` means provider acceptance, not a read receipt. Missing trip/account records
fail terminally. Manual retries reset the bounded attempt count, preserve the
payload/key, and do not resend already accepted or currently queued jobs.

## Verification

`npm run test:reliability` starts a disposable MongoDB replica set and a local HTTP
and socket server. It does not load `.env`, use the application database, or send
real email. Its first run may download a MongoDB test binary.

Run `npm run typecheck` in backend, and `npm test`, `npm run build`, and
`npm run lint` in frontend. The older `npm test` in backend is a separate
contract script that targets a running API and changes its database; run it only
against a disposable seeded environment.
