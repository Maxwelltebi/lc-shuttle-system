import type { Stop } from '../types';

/**
 * The nine stops on the Livingstone College Academic Shuttle loop.
 *
 * This is NOT mock data. Names and addresses come from the official
 * shuttle flyer (Division of Student Affairs); coordinates are geocoded
 * from OpenStreetMap and are accurate to the building.
 *
 * Held locally so the map is usable before the backend exists. When
 * Express is ready, `api/stops.ts` switches to a fetch and nothing else
 * changes — no component imports this file directly.
 */
export const STOPS: Stop[] = [
  {
    id: 'stop-1',
    name: 'Horseshoe Gate / Main Campus',
    address: '701 W Monroe St',
    lat: 35.6712869,
    lng: -80.4856795,
    sequence: 1,
  },
  {
    id: 'stop-2',
    name: 'Monroe Street Campus Housing',
    address: '1312 Monroe St',
    lat: 35.6746013,
    lng: -80.4869087,
    sequence: 2,
  },
  {
    id: 'stop-3',
    name: 'College Park Residence Hall',
    address: '1710 Old Wilkesboro Rd',
    lat: 35.6781554,
    lng: -80.4933678,
    sequence: 3,
  },
  {
    id: 'stop-4',
    name: 'Lloyd Street Campus Housing',
    address: '301 Lloyd St',
    lat: 35.67427,
    lng: -80.482662,
    sequence: 4,
  },
  {
    id: 'stop-5',
    name: 'Hood Theological Seminary',
    address: '1810 Lutheran Synod Dr',
    lat: 35.6438755,
    lng: -80.483093,
    sequence: 5,
  },
  {
    id: 'stop-6',
    name: 'Courtyard by Marriott',
    address: '120 Marriott Circle',
    lat: 35.6581116,
    lng: -80.4623623,
    sequence: 6,
  },
  {
    id: 'stop-7',
    name: 'Wyndham Property',
    address: '925 Bendix Dr',
    lat: 35.6502567,
    lng: -80.4690925,
    sequence: 7,
  },
  {
    id: 'stop-8',
    name: 'Hilton Property',
    address: '1001 Klumac Rd',
    lat: 35.6423344,
    lng: -80.4849527,
    sequence: 8,
  },
  {
    id: 'stop-9',
    name: 'Culinary Arts Facility',
    address: '530 Jake Alexander Blvd S',
    lat: 35.6465169,
    lng: -80.4884965,
    sequence: 9,
  },
];

/** Map view covering all nine stops. See README "Map and coordinates". */
export const MAP_VIEW = {
  center: [35.66, -80.4779] as [number, number],
  zoom: 13,
  maxBounds: [
    [35.635, -80.5],
    [35.685, -80.455],
  ] as [[number, number], [number, number]],
};

/**
 * Published departure times from Horseshoe Gate, for display only.
 * The server owns the authoritative service-hours calculation
 * (`ServiceStatus`) so the two cannot disagree.
 */
export const DEPARTURES = {
  morning: ['7:15', '8:15', '9:15', '10:15', '11:15'],
  afternoon: ['1:15', '2:15', '3:15', '4:15', '5:15', '6:15', '7:15'],
  lunchBreak: '12:15–1:15 PM',
  lastLoopEnds: '8:10 PM',
};
