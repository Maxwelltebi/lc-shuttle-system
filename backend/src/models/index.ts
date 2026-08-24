import mongoose, { Schema } from 'mongoose';

/**
 * Mongoose models.
 *
 * These schemas deliberately do NOT transform `_id` into `id`.
 *
 * That mapping happens in exactly one place — ../serialise.ts — because
 * having both layers do it means neither can be trusted: a document that
 * has already been rewritten no longer has an `_id` for the serialiser
 * to read, and the failure is silent (an `undefined` id inside a JWT,
 * not a crash).
 *
 * So: models return raw Mongo documents, serialisers produce API shapes.
 * The only transform here is stripping the password hash, as a safety
 * net in case a document is ever returned without going through a
 * serialiser.
 */
const stripSecrets = {
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    return ret;
  },
};

const baseOptions = {
  timestamps: true,
  toJSON: { versionKey: false },
  toObject: { versionKey: false },
};

const accountOptions = {
  timestamps: true,
  toJSON: stripSecrets,
  toObject: stripSecrets,
};

/* ------------------------------------------------------------------ */
/* Stop                                                                */
/* ------------------------------------------------------------------ */

const stopSchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    /** Position in the one-way loop. Drives board order and ETA order. */
    sequence: { type: Number, required: true, unique: true },
    /** Minutes after the hourly departure that the bus reaches this stop.
     *  Measured by riding the loop; used for schedule-based ETAs. */
    offsetMinutes: { type: Number, required: true },
  },
  baseOptions,
);

export const Stop = mongoose.model('Stop', stopSchema);

/* ------------------------------------------------------------------ */
/* Student                                                             */
/* ------------------------------------------------------------------ */

const studentSchema = new Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    homeStop: { type: Schema.Types.ObjectId, ref: 'Stop', default: null },
  },
  accountOptions,
);

export const Student = mongoose.model('Student', studentSchema);

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

const driverSchema = new Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    /** Assigned by staff on approval, never chosen by the driver. */
    bus: { type: Schema.Types.ObjectId, ref: 'Bus', default: null },
    /** Gate on going on duty. Without it, anyone with a school email
     *  could broadcast fake bus positions. */
    approved: { type: Boolean, default: false },
  },
  accountOptions,
);

export const Driver = mongoose.model('Driver', driverSchema);

/* ------------------------------------------------------------------ */
/* Bus                                                                 */
/* ------------------------------------------------------------------ */

const busSchema = new Schema(
  {
    label: { type: String, required: true },
    driver: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    onDuty: { type: Boolean, default: false },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    accuracyMeters: { type: Number, default: null },
    lastPingAt: { type: Date, default: null },
    nextStop: { type: Schema.Types.ObjectId, ref: 'Stop', default: null },
  },
  baseOptions,
);

export const Bus = mongoose.model('Bus', busSchema);

/* ------------------------------------------------------------------ */
/* WaitingCheckIn                                                      */
/* ------------------------------------------------------------------ */

const waitingCheckInSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    stop: { type: Schema.Types.ObjectId, ref: 'Stop', required: true },
    status: {
      type: String,
      enum: ['waiting', 'withdrawn', 'picked_up', 'expired'],
      default: 'waiting',
    },
    clearedBy: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    clearedAt: { type: Date, default: null },
  },
  baseOptions,
);

/** The demand board queries by stop and status on every poll. */
waitingCheckInSchema.index({ stop: 1, status: 1, createdAt: 1 });
waitingCheckInSchema.index({ student: 1, status: 1 });

export const WaitingCheckIn = mongoose.model('WaitingCheckIn', waitingCheckInSchema);

/* ------------------------------------------------------------------ */
/* RideRequest                                                         */
/* ------------------------------------------------------------------ */

const rideRequestSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    destination: { type: String, required: true },
    pickupStop: { type: Schema.Types.ObjectId, ref: 'Stop', default: null },
    pickupLabel: { type: String, required: true },
    requestedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['open', 'claimed', 'scheduled', 'expired'],
      default: 'open',
    },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    claimedAt: { type: Date, default: null },
  },
  baseOptions,
);

rideRequestSchema.index({ status: 1, createdAt: 1 });

export const RideRequest = mongoose.model('RideRequest', rideRequestSchema);

/* ------------------------------------------------------------------ */
/* RideSchedule                                                        */
/* ------------------------------------------------------------------ */

const rideScheduleSchema = new Schema(
  {
    rideRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RideRequest',
      required: true,
    },
    driver: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    tripAt: { type: Date, required: true },
    destination: { type: String, required: true },
    pickupLabel: { type: String, required: true },
    /** Null until delivery actually succeeds. A saved schedule the
     *  student never received is not a success. */
    sentAt: { type: Date, default: null },
    emailStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    /** Kept for the driver's retry, and for debugging bounces. */
    emailError: { type: String, default: null },
  },
  baseOptions,
);

export const RideSchedule = mongoose.model('RideSchedule', rideScheduleSchema);
