import { Router } from 'express';
import type { Stop as StopType } from '../../../shared/types';
import { Stop } from '../models/index.js';
import { toStop } from '../serialise.js';

export const stopsRouter = Router();

/**
 * The route, in loop order.
 *
 * Public: the map is useful before a student signs in, and stop
 * locations are printed on a flyer anyway.
 */
stopsRouter.get('/', async (_req, res) => {
  const stops = await Stop.find().sort({ sequence: 1 }).lean();
  const payload: StopType[] = stops.map(toStop);
  return res.json(payload);
});
