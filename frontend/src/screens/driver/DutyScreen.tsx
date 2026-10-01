import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, Metric, Notice, Toggle } from '../../components';
import { IconArrowRight, IconCheck } from '../../components/Icon';
import { setNextStop, setOnDuty } from '../../api/tracking';
import { fetchDemand } from '../../api/waiting';
import { usePolling } from '../../hooks/usePolling';
import { useTracking } from '../../hooks/TrackingProvider';
import { useMyBus } from '../../hooks/useMyBus';
import { useStops } from '../../hooks/useStops';
import { Screen } from '../../layouts/Screen';
import { DEPARTURES } from '../../config/stops';
import type { ApiError, StopDemand } from '../../types';
import styles from './DutyScreen.module.css';

/**
 * The driver's on-duty switch — the most consequential control here.
 *
 * Off means no student sees this bus at all, so both the switch state
 * and the GPS panel below it must tell the truth: when off duty, no
 * position is being sent, and the panel says exactly that rather than
 * showing a stale last-known ping.
 */
export function DutyScreen() {
  const stops = useStops();
  const { bus, setBus, loading } = useMyBus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { data: demand } = usePolling<StopDemand[]>(fetchDemand, []);

  /* Persistent broadcast lives in TrackingProvider (survives navigation
     between Duty/Board/Queue). This screen only reads its state. */
  const tracking = useTracking();

  const onDuty = bus?.onDuty ?? false;
  const totalWaiting = demand.reduce((sum, row) => sum + row.waitingCount, 0);

  async function handleDutyChange(next: boolean) {
    if (!bus) return;
    setBusy(true);
    setError(null);
    try {
      setBus((await setOnDuty(bus.id, next)) ?? bus);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function handleNextStop(stopId: string) {
    if (!bus) return;
    try {
      setBus((await setNextStop(bus.id, stopId)) ?? bus);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }

  /* Only claim there is no bus once the lookup has actually finished —
     otherwise every driver reads "No bus assigned" for a moment on load. */
  if (loading) return <Screen title="On duty">{null}</Screen>;

  if (!bus) {
    return (
      <Screen title="On duty">
        <Card>
          <EmptyState
            title="No bus assigned"
            body="Transportation staff assign your bus when they approve your account. Once assigned, this is where you go on duty."
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title="On duty"
      description="While you're on duty this device sends its location every 10 seconds. Off means students can't see you at all."
    >
      <div className={styles.grid}>
        <div className={styles.main}>
          <Card tone={onDuty ? 'live' : 'default'}>
            <Toggle
              checked={onDuty}
              disabled={busy}
              onChange={handleDutyChange}
              label={onDuty ? 'On duty' : 'Off duty'}
              description={
                onDuty
                  ? `Students can see ${bus.label} on the map.`
                  : 'You are invisible to students. No location is sent.'
              }
            />
          </Card>

          {error && <Notice tone="error">{error.message}</Notice>}

          <Card padded={false}>
            <div className={styles.stopListHead}>
              <p className={styles.stopListTitle}>Next stop</p>
              <p className={styles.stopListHint}>
                {onDuty
                  ? 'This is the destination students see on the map.'
                  : 'Students see nothing while you are off duty.'}
              </p>
            </div>
            {stops.map((stop) => {
              const selected = stop.id === bus.nextStopId;
              return (
                <button
                  key={stop.id}
                  type="button"
                  /* Choosing a destination while off duty would be
                     meaningless — nobody is receiving it. */
                  disabled={!onDuty}
                  onClick={() => handleNextStop(stop.id)}
                  className={`${styles.stopRow} ${selected ? styles.stopRowSelected : ''}`}
                >
                  <span className={styles.stopSequence}>{stop.sequence}</span>
                  <span className={styles.stopBody}>
                    <span className={styles.stopName}>{stop.name}</span>
                    <br />
                    <span className={styles.stopAddress}>{stop.address}</span>
                  </span>
                  {selected && <Badge tone="next">Heading here</Badge>}
                  {selected && <IconCheck size={18} />}
                </button>
              );
            })}
          </Card>
        </div>

        <aside className={styles.side}>
          <Card tone="inverse">
            <p className={styles.blockLabel}>Today's departures</p>
            <p className={styles.departures}>
              {DEPARTURES.morning.join(' · ')} AM
              <br />
              {DEPARTURES.afternoon.join(' · ')} PM
            </p>
            <p className={styles.departureNote}>
              Lunch {DEPARTURES.lunchBreak} · last loop ends{' '}
              {DEPARTURES.lastLoopEnds}
            </p>
          </Card>

          <Card>
            <p className={styles.gpsLabel}>GPS</p>
            <p className={styles.gps}>
              {!onDuty
                ? 'Not sending.\nGo on duty to start broadcasting.'
                : tracking.position
                  ? `${tracking.position.lat.toFixed(5)}, ${tracking.position.lng.toFixed(5)}\naccuracy ±${tracking.position.accuracy ?? '?'} m${bus.position ? `\nlast ping ${relativeTime(bus.position.lastPingAt)}` : ''}\nvia ${tracking.transport}`
                  : 'Waiting for a position fix…'}
            </p>
            {tracking.lastUploadError && onDuty ? <p className={styles.gpsLabel}>Upload: {tracking.lastUploadError}</p> : null}
          </Card>

          {onDuty && tracking.permission === 'denied' ? (
            <Notice tone="error" title="Not broadcasting">
              Location permission is off. Students cannot see this bus until you allow it.
            </Notice>
          ) : null}
          {onDuty && tracking.transport === 'offline' && tracking.permission !== 'denied' ? (
            <Notice tone="error" title="Connection lost">
              No connection. Positions resume automatically when it returns.
            </Notice>
          ) : null}

          <Card>
            <p className={styles.waitingTitle}>Waiting right now</p>
            <Metric value={totalWaiting} noun="students" />
            <Link to="/board" className={styles.waitingLink}>
              Open the board
              <IconArrowRight size={16} />
            </Link>
          </Card>
        </aside>
      </div>
    </Screen>
  );
}

/** "3s ago", "4 min ago" — how fresh the last position actually is. */
function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min ago`;
}
