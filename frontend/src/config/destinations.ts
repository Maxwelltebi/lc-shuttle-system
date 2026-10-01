/**
 * Common off-loop destinations students request.
 *
 * These are NOT stops: the loop serves the nine entries in `stops.ts`.
 * Requests are free text (`destination` on RideRequest), so without an
 * explicit list the map has nothing to draw and the form has nothing to
 * suggest — typed names like "Walmart" never match a pin.
 *
 * Kept in the frontend because the backend treats destinations as opaque
 * strings. Coordinates are approximate (Salisbury, NC) — verify on device
 * before relying on them for navigation.
 */
export interface Destination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const DESTINATIONS: Destination[] = [
  {
    id: 'walmart-jake-alexander',
    name: 'Walmart Supercenter',
    address: '1300 Jake Alexander Blvd S',
    lat: 35.6406,
    lng: -80.4875,
  },
  {
    id: 'rowan-medical',
    name: 'Novant Health Rowan Medical Center',
    address: '612 Mocksville Ave',
    lat: 35.6712,
    lng: -80.4715,
  },
  {
    id: 'salisbury-station',
    name: 'Salisbury Station (Amtrak)',
    address: '215 Depot St',
    lat: 35.6684,
    lng: -80.4662,
  },
  {
    id: 'food-lion-innes',
    name: 'Food Lion — E Innes St',
    address: '1015 E Innes St',
    lat: 35.6652,
    lng: -80.4615,
  },
  {
    id: 'mid-carolina-airport',
    name: 'Mid-Carolina Regional Airport',
    address: '1240 Airport Rd',
    lat: 35.6565,
    lng: -80.5195,
  },
];
