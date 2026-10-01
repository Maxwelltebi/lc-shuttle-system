import { EventEmitter } from 'node:events';
import { Bus, Stop } from '../models/index.js';
import { busStatus, toBus } from '../serialise.js';
import { computeArrivals, scheduleOffsetMinutes, serviceStatus } from './schedule.js';

export const fleetEvents = new EventEmitter();
export async function readFleet() {
  const [buses, stops] = await Promise.all([Bus.find().lean(), Stop.find().sort({ sequence: 1 }).lean()]);
  const timings = stops.map(s => ({ id: String(s._id), sequence: s.sequence, lat: s.lat, lng: s.lng, offsetMinutes: s.offsetMinutes }));
  const inService = serviceStatus().state === 'in_service';
  return buses.map(bus => {
    const fresh = busStatus(bus) === 'live' && inService;
    const next = timings.find(t => t.id === String(bus.nextStop));
    const position = fresh && typeof bus.lat === 'number' && typeof bus.lng === 'number' ? { lat: bus.lat, lng: bus.lng } : null;
    return {
      bus: toBus(bus, position && next ? scheduleOffsetMinutes(position, next) : null),
      arrivals: computeArrivals(timings, position, fresh && next ? next.id : null)
        .map(a => ({ ...a, busId: String(bus._id) })),
    };
  });
}

/** Called only after persistence; HTTP and socket mutations share this path. */
export function publishBusChange(busId: string) { fleetEvents.emit('changed', busId); }
