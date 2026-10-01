import mongoose from 'mongoose';
import { Counter, RideRequest, WaitingCheckIn } from '../models/index.js';

export async function prepareDatabase() {
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    throw new Error('MongoDB replica set is required for transactions. See backend/OPERATIONS.md.');
  }
  // Never silently discard history to make an index build succeed.
  const duplicates = await WaitingCheckIn.aggregate([
    { $match: { status: 'waiting' } },
    { $group: { _id: '$student', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }, { $limit: 1 },
  ]);
  if (duplicates.length) throw new Error('Duplicate waiting records: run npm run migrate before startup.');
  await Promise.all(Object.values(mongoose.models).map(model => model.createIndexes()));
  const references = await RideRequest.find().select('reference').lean();
  const max = references.reduce((n, r) => Math.max(n, Number(/^RR-(\d+)$/.exec(r.reference)?.[1] ?? 0)), 1000);
  await Counter.updateOne({ name: 'rideRequest' }, { $max: { value: max } }, { upsert: true });
}
