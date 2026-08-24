import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Bus, Driver, Stop, Student } from './models/index.js';

/**
 * Seeds the route and the two drivers.
 *
 * This is real data, not fixtures: the nine stops come from the official
 * shuttle flyer with coordinates geocoded from OpenStreetMap. No
 * check-ins, no ride requests — the app should start empty and fill up
 * as it is used.
 *
 * One test student is created so the student side can be exercised
 * without registering a new account after every database reset. It is a
 * development convenience, not app content: delete it before real use.
 *
 * Driver accounts are created here rather than through sign-up because
 * approval has no admin screen: seeding the two real drivers is the
 * whole approval mechanism for v1.
 */

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/lc-shuttle';

/**
 * `offsetMinutes` is how long after the hourly departure the loop
 * reaches each stop.
 *
 * These are ESTIMATES, spaced evenly across the ~55-minute loop. They
 * are the one piece of invented data in this seed, and they directly
 * drive every ETA. Replace them by riding one full loop and recording
 * the real arrival times — see README, "Open questions".
 */
const STOPS = [
  { name: 'Horseshoe Gate / Main Campus', address: '701 W Monroe St', lat: 35.6712869, lng: -80.4856795, sequence: 1, offsetMinutes: 0 },
  { name: 'Monroe Street Campus Housing', address: '1312 Monroe St', lat: 35.6746013, lng: -80.4869087, sequence: 2, offsetMinutes: 4 },
  { name: 'College Park Residence Hall', address: '1710 Old Wilkesboro Rd', lat: 35.6781554, lng: -80.4933678, sequence: 3, offsetMinutes: 9 },
  { name: 'Lloyd Street Campus Housing', address: '301 Lloyd St', lat: 35.67427, lng: -80.482662, sequence: 4, offsetMinutes: 15 },
  { name: 'Hood Theological Seminary', address: '1810 Lutheran Synod Dr', lat: 35.6438755, lng: -80.483093, sequence: 5, offsetMinutes: 23 },
  { name: 'Courtyard by Marriott', address: '120 Marriott Circle', lat: 35.6581116, lng: -80.4623623, sequence: 6, offsetMinutes: 31 },
  { name: 'Wyndham Property', address: '925 Bendix Dr', lat: 35.6502567, lng: -80.4690925, sequence: 7, offsetMinutes: 37 },
  { name: 'Hilton Property', address: '1001 Klumac Rd', lat: 35.6423344, lng: -80.4849527, sequence: 8, offsetMinutes: 43 },
  { name: 'Culinary Arts Facility', address: '530 Jake Alexander Blvd S', lat: 35.6465169, lng: -80.4884965, sequence: 9, offsetMinutes: 48 },
];

const DRIVERS = [
  { firstName: 'Maxwell', lastName: 'Tebi', email: 'm.tebi@livingstone.edu', busLabel: 'Bus 1' },
  { firstName: 'Isaac', lastName: 'Abakah', email: 'i.abakah@livingstone.edu', busLabel: 'Bus 2' },
];

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? 'shuttle2026';

/** Development login for the student side. Home stop is Hilton Property,
 *  one of the hotel properties used for student housing. */
const TEST_STUDENT = {
  firstName: 'Test',
  lastName: 'Student',
  email: 'test.student@livingstone.edu',
  homeStopSequence: 8,
};

async function seed() {
  await mongoose.connect(MONGO_URL);
  console.log(`Connected: ${MONGO_URL}`);

  /* Upsert by sequence so re-running does not duplicate the route or
     orphan the buses' nextStop references. */
  for (const stop of STOPS) {
    await Stop.findOneAndUpdate({ sequence: stop.sequence }, stop, {
      upsert: true,
      new: true,
    });
  }
  console.log(`Stops: ${await Stop.estimatedDocumentCount()}`);

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  for (const entry of DRIVERS) {
    const bus = await Bus.findOneAndUpdate(
      { label: entry.busLabel },
      { label: entry.busLabel, onDuty: false },
      { upsert: true, returnDocument: 'after' },
    );

    const driver = await Driver.findOneAndUpdate(
      { email: entry.email },
      {
        firstName: entry.firstName,
        lastName: entry.lastName,
        email: entry.email,
        passwordHash,
        bus: bus._id,
        /* Seeded drivers are approved by definition — this is the
           approval step. */
        approved: true,
      },
      { upsert: true, returnDocument: 'after' },
    );

    bus.set({ driver: driver._id });
    await bus.save();

    console.log(`Driver: ${entry.email} → ${entry.busLabel}`);
  }

  const homeStop = await Stop.findOne({ sequence: TEST_STUDENT.homeStopSequence });

  await Student.findOneAndUpdate(
    { email: TEST_STUDENT.email },
    {
      firstName: TEST_STUDENT.firstName,
      lastName: TEST_STUDENT.lastName,
      email: TEST_STUDENT.email,
      passwordHash,
      homeStop: homeStop?._id ?? null,
    },
    { upsert: true, returnDocument: 'after' },
  );

  console.log(`Student: ${TEST_STUDENT.email} → ${homeStop?.get('name')}`);

  console.log(`\nAll seeded accounts use the password: ${DEFAULT_PASSWORD}`);
  console.log('No check-ins or ride requests seeded — the app starts empty.');

  await mongoose.disconnect();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
