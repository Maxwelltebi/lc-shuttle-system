import type { Bus } from '../types';

/** Reconcile both transports by server revision, never arrival order. */
export function mergeFleet(current: Bus[], incoming: Bus[]): Bus[] {
  const byId = new Map(current.map(bus => [bus.id, bus]));
  for (const bus of incoming) {
    const previous = byId.get(bus.id);
    if (!previous || bus.revision >= previous.revision) byId.set(bus.id, bus);
  }
  return [...byId.values()];
}

export function ageFleet(buses: Bus[], now: number): Bus[] {
  return buses.map(bus => {
    if (!bus.onDuty) return { ...bus, status: 'off_duty', position: null };
    const measured = bus.position?.measuredAt;
    if (!measured || now - Date.parse(measured) > 120_000) {
      return { ...bus, status: 'offline', scheduleOffsetMinutes: null };
    }
    return bus;
  });
}
