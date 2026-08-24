import { useCallback, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Notice, StatusPill } from '../../components';
import { RouteMap } from '../../components/map/RouteMap';
import { fetchArrivals, fetchBuses, fetchServiceStatus } from '../../api/tracking';
import { fetchMyCheckIn } from '../../api/waiting';
import { usePolling } from '../../hooks/usePolling';
import { useStops } from '../../hooks/useStops';
import type { Bus, Stop, StopArrival } from '../../types';
import styles from './MapScreen.module.css';

/**
 * The student's home screen — where is the bus, and when does it reach me.
 *
 * Renders empty until a driver goes on duty: stops and the loop line are
 * drawn (real data), but there are no bus pins and no arrival times.
 */
export function MapScreen() {
  const stops = useStops();
  const { data: buses } = usePolling<Bus[]>(fetchBuses, []);
  const { data: service } = usePolling(fetchServiceStatus, null, 60_000);
  const { data: checkIn } = usePolling(fetchMyCheckIn, null, 30_000);

  /* Arrival estimates for the bus the panel is showing. Refetched on the
     same cadence as positions, since one moves the other. */
  const leadBusId = (buses.find((bus) => bus.status === 'live') ?? buses[0])?.id ?? null;
  const { data: arrivals } = usePolling<StopArrival[]>(
    useCallback(
      () => (leadBusId ? fetchArrivals(leadBusId) : Promise.resolve([])),
      [leadBusId],
    ),
    [],
  );

  /* Collapsed by default: on a phone the map is the answer, and a sheet
     that covers it defeats the screen. */
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const stopById = useMemo(
    () => new Map(stops.map((stop) => [stop.id, stop])),
    [stops],
  );

  const inService = service?.state === 'in_service';
  const leadBus = buses.find((bus) => bus.status === 'live') ?? buses[0] ?? null;

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

      {checkIn && (
        <Card tone="live">
          <span className={styles.busName}>
            <Badge tone="live" dot>
              Waiting
            </Badge>
          </span>
          <p className={styles.busHeadline}>
            {stopById.get(checkIn.stopId)?.name ?? 'Your stop'}
          </p>
        </Card>
      )}

      <ArrivalsList stops={stops} bus={leadBus} arrivals={arrivals} />
    </>
  );

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Live map</h1>
          <p className={styles.summary}>{summary}</p>
        </div>
        {service && (
          <StatusPill
            state={service.state}
            nextDepartureClock={service.nextDepartureClock}
          />
        )}
      </header>

      <div className={styles.split}>
        <div className={styles.mapPane}>
          <RouteMap
            stops={stops}
            buses={buses}
            nextStopId={leadBus?.nextStopId ?? null}
          />
        </div>
        <aside className={styles.panel}>{panel}</aside>
      </div>

      {/* Mobile: a peek sheet over the map. Collapsed it shows one line
          per bus; expanded it shows the same panel as desktop. */}
      <div
        className={`${styles.sheet} ${sheetExpanded ? styles.sheetExpanded : ''}`}
      >
        <button
          type="button"
          className={styles.sheetHandle}
          onClick={() => setSheetExpanded((open) => !open)}
          aria-expanded={sheetExpanded}
        >
          <span className={styles.grabber} />
          <span className={styles.sheetHint}>
            {sheetExpanded ? 'Hide details' : 'Arrivals and details'}
          </span>
        </button>

        {sheetExpanded ? (
          <div className={styles.sheetBody}>{panel}</div>
        ) : (
          <div className={styles.peek}>
            {buses.length === 0 ? (
              <p className={styles.peekMuted}>
                {service && service.state !== 'in_service'
                  ? service.message
                  : 'No buses on the road right now.'}
              </p>
            ) : (
              buses.map((bus) => (
                <span key={bus.id} className={styles.peekRow}>
                  <span className={styles.peekLabel}>
                    <Badge tone={bus.status === 'live' ? 'live' : 'muted'} dot>
                      {bus.label}
                    </Badge>
                  </span>
                  <span className={styles.peekValue}>{peekLine(bus, stopById)}</span>
                </span>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One compact line for the collapsed mobile sheet. */
function peekLine(bus: Bus, stopById: Map<string, Stop>): string {
  if (bus.status !== 'live') return 'offline';
  const nextStop = bus.nextStopId ? stopById.get(bus.nextStopId) : null;
  if (!nextStop) return 'on the road';
  return `→ ${nextStop.name}`;
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
            No recent position. Showing the timetable instead.
          </p>
        </>
      ) : (
        <>
          <p className={styles.busHeadline}>
            {bus.label}
            {nextStop ? ` → ${nextStop.name}` : ''}
          </p>
          <p className={styles.busDetail}>{busSummaryLine(bus)}</p>
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
