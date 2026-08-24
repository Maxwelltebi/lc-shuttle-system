import { useMemo, useState } from 'react';
import { Badge, Button, Card, Metric, Notice } from '../../components';
import { clearStop, fetchDemand } from '../../api/waiting';
import { useMyBus } from '../../hooks/useMyBus';
import { usePolling } from '../../hooks/usePolling';
import { useStops } from '../../hooks/useStops';
import { Screen } from '../../layouts/Screen';
import type { ApiError, StopDemand } from '../../types';
import styles from './BoardScreen.module.css';

/**
 * The waiting board — nine stops in route order, live counts, one-tap
 * clear per stop.
 *
 * Route order, not alphabetical or by count: the driver reads it in the
 * order they will physically arrive.
 */
export function BoardScreen() {
  const stops = useStops();
  const { data: demand, loading } = usePolling<StopDemand[]>(fetchDemand, []);
  const { bus } = useMyBus();
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const demandByStop = useMemo(
    () => new Map(demand.map((row) => [row.stopId, row])),
    [demand],
  );

  const total = demand.reduce((sum, row) => sum + row.waitingCount, 0);

  async function handleClear(stopId: string) {
    setClearing(stopId);
    setError(null);
    try {
      await clearStop(stopId);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setClearing(null);
    }
  }

  return (
    <Screen
      title="Waiting board"
      description={`${stops.length} stops in route order. Refreshes every 10 seconds.`}
      action={
        <Card>
          <div className={styles.total}>
            <span className={styles.totalValue}>{total}</span>{' '}
            <span className={styles.totalLabel}>waiting</span>
          </div>
        </Card>
      }
    >
      {/* A driver who forgot to go on duty is invisible to every student.
          Nothing else on this screen would reveal that. */}
      {bus && !bus.onDuty && (
        <div className={styles.warning}>
          <Notice tone="warning" title="You are off duty">
            Students cannot see your bus on the map. Go on duty to start
            broadcasting.
          </Notice>
        </div>
      )}

      {error && (
        <div className={styles.warning}>
          <Notice tone="error">{error.message}</Notice>
        </div>
      )}

      <div className={styles.grid}>
        {stops.map((stop) => {
          const row = demandByStop.get(stop.id);
          const count = row?.waitingCount ?? 0;
          const isNext = bus?.nextStopId === stop.id;

          return (
            <Card key={stop.id} className={styles.card}>
              <div className={styles.head}>
                <span className={styles.sequence}>Stop {stop.sequence}</span>
                {isNext && <Badge tone="next">Next</Badge>}
              </div>

              <p className={styles.name}>{stop.name}</p>

              <Metric value={count} noun="students waiting" />

              <p className={styles.oldest}>
                {count === 0
                  ? 'Nobody checked in'
                  : row?.oldestCheckInAt
                    ? `Oldest ${relativeMinutes(row.oldestCheckInAt)}`
                    : ''}
              </p>

              <Button
                block
                /* Stays visible at zero so the board keeps its shape, but
                   is clearly inert — there is nothing to clear. */
                disabled={count === 0 || clearing === stop.id || loading}
                onClick={() => handleClear(stop.id)}
              >
                {clearing === stop.id ? 'Clearing…' : 'Clear all'}
              </Button>
            </Card>
          );
        })}
      </div>
    </Screen>
  );
}

/** "14 min ago" — how long the longest-waiting student has stood there. */
function relativeMinutes(iso: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}
