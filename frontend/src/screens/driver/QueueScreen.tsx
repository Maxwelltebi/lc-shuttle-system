import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldRow,
  Notice,
  TextField,
} from '../../components';
import {
  claimRequest,
  fetchQueue,
  resendSchedule,
  scheduleRequest,
} from '../../api/requests';
import { usePolling } from '../../hooks/usePolling';
import { Screen } from '../../layouts/Screen';
import type { ApiError, QueueEntry, RideSchedule } from '../../types';
import styles from './QueueScreen.module.css';

/**
 * The shared request queue.
 *
 * Claiming is atomic on the server. When two drivers tap at the same
 * instant the loser receives `claim_conflict` and is told plainly —
 * a silent failure would leave them believing they had the trip.
 */
export function QueueScreen() {
  const { data: queue, loading } = usePolling<QueueEntry[]>(fetchQueue, []);
  const [scheduling, setScheduling] = useState<QueueEntry | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState<RideSchedule | null>(null);

  async function handleClaim(entry: QueueEntry) {
    setBusy(true);
    setError(null);
    try {
      await claimRequest(entry.id);
      setScheduling(entry);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!scheduling) return;
    setBusy(true);
    setError(null);
    try {
      const schedule = await scheduleRequest(scheduling.id, {
        tripAt: new Date(`${date}T${time}`).toISOString(),
      });
      setSent(schedule);
      setScheduling(null);
      setDate('');
      setTime('');
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (!sent) return;
    setBusy(true);
    try {
      setSent(await resendSchedule(sent.id));
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Request queue"
      description="Open requests, oldest first. Claiming one takes it off the other driver's list."
    >
      <div className={styles.layout}>
        <div>
          {/* Losing a claim race. Not in the designs; required by FR3.4. */}
          {error?.code === 'claim_conflict' && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Notice tone="warning" title="Already claimed">
                The other driver claimed this one first. It has left your queue.
              </Notice>
            </div>
          )}

          {error && error.code !== 'claim_conflict' && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Notice tone="error">{error.message}</Notice>
            </div>
          )}

          {/* A schedule saved but not emailed is not a success. */}
          {sent && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              {sent.emailStatus === 'failed' ? (
                <Notice tone="error" title="Schedule saved, email not delivered">
                  The student has not been told. Try sending again.
                  <span style={{ display: 'block', marginTop: 'var(--space-3)' }}>
                    <Button size="sm" variant="outline" onClick={handleResend} disabled={busy}>
                      Resend email
                    </Button>
                  </span>
                </Notice>
              ) : (
                <Notice tone="success" title="Schedule sent">
                  {sent.sentAt
                    ? `Emailed to the student at ${formatClock(sent.sentAt)}.`
                    : 'The confirmation email is on its way.'}
                </Notice>
              )}
            </div>
          )}

          {queue.length === 0 ? (
            <Card>
              <EmptyState
                title={loading ? 'Loading requests' : 'Nothing in the queue'}
                body={
                  loading
                    ? undefined
                    : 'Off-route trip requests from students appear here, oldest first.'
                }
              />
            </Card>
          ) : (
            <div className={styles.list}>
              {queue.map((entry) => (
                <Card
                  key={entry.id}
                  tone={entry.status === 'claimed' ? 'highlighted' : 'default'}
                >
                  <div className={styles.row}>
                    <div className={styles.body}>
                      <div className={styles.head}>
                        <span className={styles.destination}>
                          {entry.destination}
                        </span>
                        {entry.status === 'claimed' && (
                          <Badge tone="accent">Claimed by you</Badge>
                        )}
                      </div>
                      <p className={styles.meta}>
                        {entry.studentName} · pickup {entry.pickupLabel}
                      </p>
                      <p className={styles.submitted}>
                        Wants {formatDateTime(entry.requestedAt)} · submitted{' '}
                        {relativeDays(entry.createdAt)}
                      </p>
                    </div>

                    {entry.status === 'claimed' ? (
                      <Button
                        variant="outline"
                        onClick={() => setScheduling(entry)}
                      >
                        Set a time
                      </Button>
                    ) : (
                      <Button
                        variant="accent"
                        disabled={busy}
                        onClick={() => handleClaim(entry)}
                      >
                        Claim
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <p className={styles.footnote} style={{ marginTop: 'var(--space-5)' }}>
            A claim with no schedule after 12 hours goes back to the queue.
            Requests whose time has passed drop out quietly.
          </p>
        </div>

        {scheduling && (
          <Card>
            <p className={styles.scheduleTitle}>Schedule this trip</p>
            <p className={styles.scheduleName}>{scheduling.destination}</p>
            <p className={styles.scheduleMeta}>
              {scheduling.studentName} · pickup {scheduling.pickupLabel}
            </p>

            <form className={styles.scheduleForm} onSubmit={handleSend}>
              <FieldRow>
                <TextField
                  label="Date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
                <TextField
                  label="Time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </FieldRow>

              <Notice tone="info">
                Sending emails the student the date, time, destination, and
                pickup point.
              </Notice>

              <Button type="submit" size="lg" block disabled={busy}>
                {busy ? 'Sending…' : 'Send schedule'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                block
                onClick={() => setScheduling(null)}
              >
                Not now
              </Button>
            </form>
          </Card>
        )}
      </div>
    </Screen>
  );
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function relativeDays(iso: string) {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
