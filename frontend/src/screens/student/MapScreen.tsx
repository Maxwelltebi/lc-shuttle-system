import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Badge, Card, EmptyState, Notice } from '../../components';
import { RouteMap } from '../../components/map/RouteMap';
import { fetchArrivals, fetchBuses, fetchServiceStatus } from '../../api/tracking';
import { checkIn as requestCheckIn, fetchMyCheckIn, withdrawCheckIn } from '../../api/waiting';
import { usePolling } from '../../hooks/usePolling';
import { mergeFleet, ageFleet } from '../../hooks/fleetState';
import { useSocket } from '../../hooks/useSocket';
import { useSession } from '../../hooks/useSession';
import { useStops } from '../../hooks/useStops';
import type { ApiError, Bus, Stop, StopArrival, WaitingCheckIn } from '../../types';
import styles from './MapScreen.module.css';

const DRAWER_LINKS = [
  { to: '/map', label: 'Map' },
  { to: '/waiting', label: 'Waiting' },
  { to: '/request', label: 'Request' },
  { to: '/trips', label: 'My trips' },
  { to: '/profile', label: 'Profile' },
];

/**
 * The student's home screen — where is the bus, and when does it reach me.
 *
 * Socket primary, HTTP polling fallback every 10s while disconnected.
 * Shows last saved location with its age when live updates stop.
 *
 * Layout follows the LC Shuttle home mock: app bar, trip card, full-bleed
 * map, shuttle status cards, and one big "I am waiting" check-in button.
 * Arrivals and service detail live behind a collapsible section (and the
 * desktop side panel) so the map stays the point of the screen.
 */
export function MapScreen() {
  const navigate = useNavigate();
  const { user, endSession } = useSession();
  const stops = useStops();
  const [liveBuses, setLiveBuses] = useState<Bus[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const { data: polledBuses, error: busesError } = usePolling<Bus[]>(fetchBuses, []);
  const { data: service } = usePolling(fetchServiceStatus, null, 60_000);
  const { data: polledCheckIn } = usePolling(fetchMyCheckIn, null, 30_000);

  const { state: socketState } = useSocket(
    useCallback((snapshot: Bus[]) => setLiveBuses(previous => mergeFleet(previous, snapshot)), []),
    useCallback((bus: Bus) => setLiveBuses(previous => mergeFleet(previous, [bus])), []),
  );
  // Polling also reconciles healthy sockets when a broadcast was missed.
  useEffect(() => { setLiveBuses(previous => mergeFleet(previous, polledBuses)); }, [polledBuses]);
  const buses = useMemo(() => ageFleet(liveBuses, now), [liveBuses, now]);

  /* The card tapped in the status row decides whose arrivals are shown. */
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const leadBus = buses.find((bus) => bus.status === 'live') ?? buses[0] ?? null;
  const shownBus = buses.find((bus) => bus.id === selectedBusId) ?? leadBus;

  /* Arrival estimates for the bus the panel is showing. Refetched on the
     same cadence as positions, since one moves the other. */
  const shownBusId = shownBus?.id ?? null;
  const { data: arrivals } = usePolling<StopArrival[]>(
    useCallback(
      () => (shownBusId ? fetchArrivals(shownBusId) : Promise.resolve([])),
      [shownBusId],
    ),
    [],
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);

  const stopById = useMemo(
    () => new Map(stops.map((stop) => [stop.id, stop])),
    [stops],
  );

  const inService = service?.state === 'in_service';
  const hasAlert = service != null && service.state !== 'in_service';

  /* Trip card: origin defaults to the active check-in, then the student's
     home stop; destination defaults to Main Campus. */
  const homeStopId = user?.role === 'student' ? user.homeStopId : null;
  const [originStopId, setOriginStopId] = useState<string | null>(null);
  const [destStopId, setDestStopId] = useState<string | null>(null);
  useEffect(() => {
    if (!originStopId && stops.length > 0) {
      setOriginStopId(polledCheckIn?.stopId ?? homeStopId ?? stops[0].id);
    }
  }, [originStopId, stops, polledCheckIn, homeStopId]);
  useEffect(() => {
    if (!destStopId && stops.length > 0) {
      setDestStopId(
        stops.find((stop) => /main campus/i.test(stop.name))?.id ?? stops[0].id,
      );
    }
  }, [destStopId, stops]);
  useEffect(() => {
    if (polledCheckIn) setOriginStopId(polledCheckIn.stopId);
  }, [polledCheckIn]);

  const originStop = originStopId ? stopById.get(originStopId) ?? null : null;

  /* "I am waiting" state. The poll refreshes every 30s; the local override
     keeps the button truthful immediately after a tap. */
  const [localCheckIn, setLocalCheckIn] = useState<WaitingCheckIn | null | undefined>(undefined);
  const activeCheckIn = localCheckIn !== undefined ? localCheckIn : polledCheckIn;
  useEffect(() => { setLocalCheckIn(undefined); }, [polledCheckIn?.id]);
  const [ctaBusy, setCtaBusy] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);

  async function handleCta() {
    if (ctaBusy) return;
    setCtaBusy(true);
    setCtaError(null);
    try {
      if (activeCheckIn) {
        await withdrawCheckIn(activeCheckIn.id);
        setLocalCheckIn(null);
      } else if (originStopId) {
        const created = await requestCheckIn(originStopId);
        setLocalCheckIn(created ?? (await fetchMyCheckIn()));
      }
    } catch (caught) {
      setCtaError((caught as ApiError)?.message ?? 'Could not update your check-in.');
    } finally {
      setCtaBusy(false);
    }
  }

  const summary = !service
    ? 'Waiting for service information.'
    : !inService
      ? service.message
      : buses.length === 0
        ? 'No buses are on duty right now.'
        : buses
            .map((bus) => busSummaryLine(bus))
            .filter(Boolean)
            .join(' ');
  const liveNote =
    socketState === 'connected' ? 'Live updates.' : 'Reconnecting — showing last saved positions (10s refresh).';

  const panel = (
    <>
      {buses.length === 0 ? (
        <Card tone={inService ? 'default' : 'muted'}>
          <EmptyState
            title={inService ? 'No buses on the road' : 'No service right now'}
            body={
              service?.message ??
              'Nothing is broadcasting yet. Bus positions appear here as soon as a driver goes on duty.'
            }
          />
        </Card>
      ) : (
        buses.map((bus) => <BusCard key={bus.id} bus={bus} stopById={stopById} />)
      )}

      {service && service.state !== 'in_service' && service.nextDepartureClock && (
        <Card tone="accent">
          <div className={styles.busHead}>
            <span className={styles.busName}>Next</span>
            <span className={styles.arrivalEta}>{service.nextDepartureClock}</span>
          </div>
          <p className={styles.busHeadline}>
            Next departure {service.nextDepartureClock}
          </p>
        </Card>
      )}

      {activeCheckIn && (
        <Card tone="live">
          <span className={styles.busName}>
            <Badge tone="live" dot>
              Waiting
            </Badge>
          </span>
          <p className={styles.busHeadline}>
            {stopById.get(activeCheckIn.stopId)?.name ?? 'Your stop'}
          </p>
        </Card>
      )}

      {busesError ? <Notice tone="error">Could not refresh positions. Showing last known.</Notice> : null}
      <p className={styles.liveNote}>{summary} {buses.length > 0 ? liveNote : ''}</p>

      <ArrivalsList stops={stops} bus={shownBus} arrivals={arrivals.map(a => shownBus?.status === 'live' && inService ? a : { ...a, etaMinutes: null, etaClock: null })} />
    </>
  );

  return (
    <div className={styles.layout}>
      <header className={styles.appbar}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <p className={styles.brand}>
          <span className={styles.brandLc}>LC</span> Shuttle
        </p>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setDetailsOpen((open) => !open)}
          aria-label={hasAlert ? 'Service alert — show details' : 'Notifications — show details'}
          aria-expanded={detailsOpen}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
            <path d="M10 19a2.2 2.2 0 0 0 4 0" />
          </svg>
          {hasAlert ? <span className={styles.bellDot} aria-hidden /> : null}
        </button>
      </header>

      {drawerOpen ? (
        <div className={styles.drawerRoot}>
          <div className={styles.scrim} onClick={() => setDrawerOpen(false)} aria-hidden />
          <nav className={styles.drawer} aria-label="Menu">
            <p className={styles.brand}>
              <span className={styles.brandLc}>LC</span> Shuttle
            </p>
            {user ? (
              <p className={styles.drawerUser}>
                {user.firstName} {user.lastName}
              </p>
            ) : null}
            {DRAWER_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `${styles.drawerLink} ${isActive ? styles.drawerLinkActive : ''}`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <button type="button" className={styles.drawerSignOut} onClick={endSession}>
              Sign out
            </button>
          </nav>
        </div>
      ) : null}

      <div className={styles.split}>
        <div className={styles.mapColumn}>
          <div className={styles.tripCard}>
            <div className={styles.tripRow}>
              <span className={styles.rail} aria-hidden>
                <span className={styles.railDotStart} />
                <span className={styles.railLine} />
                <span className={styles.railDotEnd} />
              </span>
              <span className={styles.tripFields}>
                <span className={styles.tripField}>
                  <span className={styles.tripLabel}>Your location</span>
                  <select
                    className={styles.tripSelect}
                    value={originStopId ?? ''}
                    onChange={(event) => setOriginStopId(event.target.value || null)}
                    aria-label="Your location"
                  >
                    {stops.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span className={styles.tripDivider} aria-hidden />
                <span className={styles.tripField}>
                  <span className={styles.tripLabel}>Destination</span>
                  <select
                    className={styles.tripSelect}
                    value={destStopId ?? ''}
                    onChange={(event) => setDestStopId(event.target.value || null)}
                    aria-label="Destination"
                  >
                    {stops.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.name}
                      </option>
                    ))}
                  </select>
                </span>
              </span>
              <span className={styles.tripIcons}>
                <button
                  type="button"
                  className={styles.tripIconBtn}
                  onClick={() => setRecenterSignal((n) => n + 1)}
                  aria-label="Re-center on my location"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <circle cx="12" cy="12" r="6.5" />
                    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
                    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.tripIconBtnMuted}
                  onClick={() => navigate('/request')}
                  aria-label="Add a destination request"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </span>
            </div>
          </div>

          <div className={styles.mapPane}>
            <RouteMap
              stops={stops}
              buses={buses}
              nextStopId={shownBus?.nextStopId ?? null}
              showStopLabels={false}
              userPoint={originStop ? { lat: originStop.lat, lng: originStop.lng } : null}
              focusPoint={originStop ? { lat: originStop.lat, lng: originStop.lng } : null}
              recenterSignal={recenterSignal}
            />
            <button
              type="button"
              className={styles.recenterFab}
              onClick={() => setRecenterSignal((n) => n + 1)}
              aria-label="Re-center map"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="6.5" />
                <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
                <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className={styles.bottomStack}>
            {buses.length === 0 ? (
              <div className={styles.shuttleCards}>
                <div className={styles.shuttleEmpty}>
                  {service && service.state !== 'in_service'
                    ? service.message
                    : 'No buses on the road right now.'}
                </div>
              </div>
            ) : (
              <div className={styles.shuttleCards}>
                {buses.map((bus) => {
                  const live = bus.status === 'live';
                  const selected = shownBus?.id === bus.id;
                  return (
                    <button
                      key={bus.id}
                      type="button"
                      className={`${styles.shuttleCard} ${selected ? styles.shuttleCardSelected : ''}`}
                      onClick={() => setSelectedBusId(selected ? null : bus.id)}
                      aria-pressed={selected}
                      aria-label={`${shuttleName(bus.label)}, ${live ? 'online' : 'offline'}`}
                    >
                      <BusArt />
                      <span className={styles.shuttleMeta}>
                        <span className={styles.shuttleName}>
                          {shuttleName(bus.label)}
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="m9 6 6 6-6 6" />
                          </svg>
                        </span>
                        <span className={styles.shuttleStatus}>
                          <span className={`${styles.statusDot} ${live ? styles.statusDotLive : styles.statusDotOffline}`} aria-hidden />
                          <span className={live ? styles.statusLive : styles.statusOffline}>
                            {live ? 'Online' : 'Offline'}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              className={styles.cta}
              onClick={handleCta}
              disabled={ctaBusy || (!activeCheckIn && !originStopId)}
            >
              {ctaBusy
                ? 'Updating…'
                : activeCheckIn
                  ? `Waiting at ${stopById.get(activeCheckIn.stopId)?.name ?? 'your stop'} · tap to cancel`
                  : 'I am waiting'}
            </button>
            {ctaError ? <p className={styles.ctaError}>{ctaError}</p> : null}

            <button
              type="button"
              className={styles.detailsToggle}
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide arrivals and details' : 'Arrivals and details'}
            </button>
            {detailsOpen ? <div className={styles.detailsBody}>{panel}</div> : null}
          </div>
        </div>

        <aside className={styles.panel}>{panel}</aside>
      </div>
    </div>
  );
}

/** Front three-quarter shuttle illustration for the status cards. */
function BusArt() {
  return (
    <svg className={styles.busArt} viewBox="0 0 96 56" aria-hidden>
      <ellipse cx="48" cy="50" rx="36" ry="4" fill="rgba(15,23,42,0.12)" />
      <rect x="8" y="8" width="72" height="30" rx="7" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <rect x="14" y="13" width="40" height="11" rx="2.5" fill="#1d4ed8" />
      <path d="M56 13h13l5 11H56Z" fill="#0f172a" />
      <path d="M57.5 14.5h10.5l3.6 8H57.5Z" fill="#93c5fd" />
      <rect x="8" y="29" width="72" height="4" fill="#1d4ed8" />
      <text x="34" y="21.5" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fontWeight="bold" fill="#ffffff">LC</text>
      <circle cx="26" cy="41" r="7" fill="#0f172a" />
      <circle cx="26" cy="41" r="2.6" fill="#94a3b8" />
      <circle cx="66" cy="41" r="7" fill="#0f172a" />
      <circle cx="66" cy="41" r="2.6" fill="#94a3b8" />
    </svg>
  );
}

/** "Bus 1" → "Shuttle 1", matching the rider-facing naming. */
function shuttleName(label: string): string {
  return label.replace(/^bus/i, 'Shuttle');
}

/** "Bus 1 is 7 minutes behind the 2:15 PM loop." */
function busSummaryLine(bus: Bus): string {
  if (bus.status === 'offline') return `${bus.label} has not pinged recently.`;
  if (!bus.onDuty) return '';
  if (bus.scheduleOffsetMinutes === null) return `${bus.label} is on the road.`;
  if (bus.scheduleOffsetMinutes === 0) return `${bus.label} is on time.`;
  const late = bus.scheduleOffsetMinutes > 0;
  const minutes = Math.abs(bus.scheduleOffsetMinutes);
  return `${bus.label} is ${minutes} minute${minutes === 1 ? '' : 's'} ${late ? 'behind' : 'ahead of'} schedule.`;
}

function BusCard({ bus, stopById }: { bus: Bus; stopById: Map<string, Stop> }) {
  const offline = bus.status !== 'live';
  const nextStop = bus.nextStopId ? stopById.get(bus.nextStopId) : null;

  return (
    <Card tone={offline ? 'muted' : 'default'}>
      <div className={styles.busHead}>
        <span className={styles.busName}>
          <Badge tone={offline ? 'muted' : 'live'} dot>
            {bus.label}
          </Badge>
        </span>
        <Badge tone={offline ? 'muted' : 'live'}>
          {bus.status === 'live' ? 'Live' : bus.onDuty ? 'Offline' : 'Off'}
        </Badge>
      </div>

      {offline ? (
        <>
          <p className={styles.busHeadline}>{bus.label} — offline</p>
          <p className={styles.busDetail}>
            No recent position{bus.position ? ` (last ${relativeAge(bus.position.measuredAt ?? bus.position.lastPingAt)})` : ''}. Showing the timetable instead.
          </p>
        </>
      ) : (
        <>
          <p className={styles.busHeadline}>
            {bus.label}
            {nextStop ? ` → ${nextStop.name}` : ''}
          </p>
          <p className={styles.busDetail}>{busSummaryLine(bus)}{bus.position ? ` Updated ${relativeAge(bus.position.lastPingAt)}.` : ''}</p>
        </>
      )}
    </Card>
  );
}

/**
 * Arrivals for the lead bus.
 *
 * Sorted by when the bus actually reaches each stop, not by stop number:
 * after stop 9 it wraps to stop 1, so route order and arrival order are
 * different lists. The student wants "what is coming next".
 */
function ArrivalsList({
  stops,
  bus,
  arrivals,
}: {
  stops: Stop[];
  bus: Bus | null;
  arrivals: StopArrival[];
}) {
  const byStop = useMemo(
    () => new Map(arrivals.map((arrival) => [arrival.stopId, arrival])),
    [arrivals],
  );

  const ordered = useMemo(() => {
    if (!bus?.nextStopId) return stops;
    const startIndex = stops.findIndex((stop) => stop.id === bus.nextStopId);
    if (startIndex < 0) return stops;
    return [...stops.slice(startIndex), ...stops.slice(0, startIndex)];
  }, [stops, bus]);

  if (stops.length === 0) return null;

  return (
    <div>
      <p className={styles.arrivalsLabel}>
        {bus ? `Arrivals — ${bus.label}` : 'Stops on the loop'}
      </p>
      <Card padded={false} style={{ marginTop: 'var(--space-3)' }}>
        {ordered.map((stop, index) => (
          <div key={stop.id} className={styles.arrival}>
            <span className={styles.arrivalSequence}>{stop.sequence}</span>
            <span className={styles.arrivalName}>
              {stop.name}
              <br />
              <span className={styles.arrivalAddress}>{stop.address}</span>
            </span>
            <span
              className={`${styles.arrivalEta} ${index === 0 && bus ? styles.arrivalNext : ''}`}
            >
              {formatArrival(byStop.get(stop.id))}
            </span>
          </div>
        ))}
      </Card>
      {!bus && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Notice tone="info">
            Arrival times appear once a driver goes on duty.
          </Notice>
        </div>
      )}
    </div>
  );
}

/**
 * Minutes when a bus is broadcasting; the printed timetable time when it
 * is not. Falling back to the schedule is the whole point of holding
 * both values — an offline bus should still tell you when it is due.
 */
function formatArrival(arrival: StopArrival | undefined): string {
  if (!arrival) return '—';
  if (arrival.etaMinutes !== null) return `${arrival.etaMinutes} min`;
  if (arrival.scheduledClock) return arrival.scheduledClock;
  return '—';
}

function relativeAge(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}
