import './env.js';
import mongoose from 'mongoose';
import { WaitingCheckIn } from './models/index.js';
import { prepareDatabase } from './services/database.js';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/lc-shuttle', { autoIndex: false });
try {
  const groups = await WaitingCheckIn.aggregate([
    { $match: { status: 'waiting' } }, { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: '$student', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log('Students with duplicate waiting records:', groups.length);
  if (process.argv.includes('--apply')) {
    for (const group of groups) {
      await WaitingCheckIn.updateMany({ _id: { $in: group.ids.slice(1) }, status: 'waiting' }, { status: 'withdrawn' });
    }
    await prepareDatabase();
    console.log('Indexes and reference counter prepared.');
  } else console.log('Read-only audit. Stop the API and run npm run migrate -- --apply to retain newest waiting records and prepare indexes.');
} finally { await mongoose.disconnect(); }
