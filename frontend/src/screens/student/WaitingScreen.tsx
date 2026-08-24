import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Notice } from '../../components';
import { IconArrowRight, IconCheck } from '../../components/Icon';
import { checkIn, fetchMyCheckIn, withdrawCheckIn } from '../../api/waiting';
import { useStops } from '../../hooks/useStops';
import { Screen } from '../../layouts/Screen';
import type { ApiError, Stop, WaitingCheckIn } from '../../types';
import styles from './WaitingScreen.module.css';

/**
 * "I'm waiting" — the student tells both drivers someone is at a stop.
 *
 * Two states in one screen: choosing a stop, and holding an active
 * check-in. The active state takes over the side panel and locks the
 * list, because a student may only hold one check-in at a time (FR2.2).
 */
export function WaitingScreen() {
  const stops = useStops();
  const [active, setActive] = useState<WaitingCheckIn | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    fetchMyCheckIn().then(setActive).catch(() => undefined);
  }, []);

  const selectedStop =
    stops.find((stop) => stop.id === (active?.stopId ?? selectedStopId)) ?? null;

  async function handleCheckIn() {
    if (!selectedStopId) return;
    setBusy(true);
    setError(null);
    try {
      setActive(await checkIn(selectedStopId));
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawCheckIn(active.id);
      setActive(null);
      setSelectedStopId(null);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (stops.length === 0) {
    return (
      <Screen title="I'm waiting">
        <Card>
          <EmptyState
            title="No stops available"
            body="The route has not loaded yet."
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title="I'm waiting"
      description="Tell both drivers someone is standing at your stop. One check-in at a time."
    >
      <div className={styles.split}>
        <div className={styles.listPane}>
          <p className={styles.listLabel}>Pick your stop</p>
          <div className={styles.list}>
            {stops.map((stop) => (
              <StopOption
                key={stop.id}
                stop={stop}
                selected={(active?.stopId ?? selectedStopId) === stop.id}
                /* Locked while a check-in is active — cancel first. */
                disabled={Boolean(active)}
                onSelect={() => setSelectedStopId(stop.id)}
              />
            ))}
          </div>
        </div>

        <aside className={styles.side}>
          {active ? (
            <Card tone="live">
              <span className={styles.eyebrow}>
                <Badge tone="live" dot>
                  Waiting
                </Badge>
              </span>
              <p className={styles.sideTitle}>{selectedStop?.name}</p>
              <p className={styles.sideMeta}>
                Checked in at {formatClock(active.createdAt)} · clears
                automatically at {formatClock(active.expiresAt)} if nobody picks
                you up.
              </p>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Button variant="danger" block disabled={busy} onClick={handleWithdraw}>
                  Cancel check-in
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <span className={styles.eyebrow}>Selected stop</span>
              <p className={styles.sideTitle}>
                {selectedStop?.name ?? 'No stop selected'}
              </p>
              <p className={styles.sideMeta}>
                {selectedStop?.address ?? 'Choose where you are standing.'}
              </p>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Button
                  variant="accent"
                  block
                  disabled={!selectedStopId || busy}
                  onClick={handleCheckIn}
                >
                  I'm waiting here
                </Button>
              </div>
            </Card>
          )}

          {error && <Notice tone="error">{error.message}</Notice>}

          <Card>
            <p className={styles.cardTitle}>How it clears</p>
            <p className={styles.cardBody}>
              The driver clears the whole stop when they pick up. You can cancel
              any time, and a forgotten check-in expires after 1 hour 30 minutes.
            </p>
          </Card>

          <Card>
            <p className={styles.cardTitle}>Not on the route?</p>
            <p className={styles.cardBody}>
              If the shuttle doesn't serve where you are, submit a ride request
              instead.
            </p>
            <Link to="/request" className={styles.inlineLink}>
              Request a ride
              <IconArrowRight size={16} />
            </Link>
          </Card>
        </aside>
      </div>

      {/* Mobile: the primary action is pinned rather than inside the panel. */}
      {!active && selectedStop && (
        <div className={styles.confirmBar}>
          <Button variant="accent" block disabled={busy} onClick={handleCheckIn}>
            Confirm — {selectedStop.name}
          </Button>
        </div>
      )}
    </Screen>
  );
}

function StopOption({
  stop,
  selected,
  disabled,
  onSelect,
}: {
  stop: Stop;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
      aria-pressed={selected}
    >
      <span className={`${styles.radio} ${selected ? styles.radioSelected : ''}`}>
        {selected && <IconCheck size={14} />}
      </span>
      <span className={styles.optionBody}>
        <span className={styles.optionName}>{stop.name}</span>
        <br />
        {/* Distance and next-bus minutes appear here once the backend
            supplies them; the address alone until then. */}
        <span className={styles.optionMeta}>{stop.address}</span>
      </span>
    </button>
  );
}

/** "2:04 PM" in the viewer's locale. */
function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
