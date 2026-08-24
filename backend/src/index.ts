import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import type { ApiError } from '../../shared/types';
import { authRouter } from './routes/auth.js';
import { stopsRouter } from './routes/stops.js';
import { trackingRouter } from './routes/tracking.js';
import { waitingRouter } from './routes/waiting.js';
import { requestsRouter, schedulesRouter } from './routes/requests.js';

const PORT = Number(process.env.PORT ?? 4000);
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/lc-shuttle';
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = express();

app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

/* Mount paths match exactly what the frontend already calls — see
   frontend/INTEGRATION.md. */
app.use('/api/auth', authRouter);
app.use('/api/stops', stopsRouter);
app.use('/api', trackingRouter);
app.use('/api/waiting', waitingRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/schedules', schedulesRouter);

app.use((_req, res) => {
  const body: ApiError = { code: 'not_found', message: 'No such endpoint.' };
  return res.status(404).json(body);
});

/**
 * Every unhandled failure leaves as an ApiError, so the frontend always
 * has a `code` to branch on and a `message` it can render. A raw Express
 * HTML error page would break that contract.
 */
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    const body: ApiError = {
      code: 'server_error',
      message: 'Something went wrong. Try again.',
    };
    return res.status(500).json(body);
  },
);

async function start() {
  await mongoose.connect(MONGO_URL);
  console.log(`Mongo connected: ${MONGO_URL}`);
  app.listen(PORT, () => {
    console.log(`LC Shuttle API on http://localhost:${PORT}`);
    console.log(`CORS origin: ${ORIGIN}`);
  });
}

start().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
