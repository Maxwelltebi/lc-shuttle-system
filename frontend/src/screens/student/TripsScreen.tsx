import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState } from '../../components';
import { fetchMyRequests } from '../../api/requests';
import { usePolling } from '../../hooks/usePolling';
import { Screen } from '../../layouts/Screen';
import type { RideRequest, RideRequestStatus } from '../../types';
import styles from './TripsScreen.module.css';

/**
 * The student's own ride requests.
 *
 * Exists because silent expiry is a deliberate design decision: nothing
 * notifies a student when no driver took their trip, so this list is the
 * only place they can find out.
 */
export function TripsScreen() {
  const { data: requests } = usePolling<RideRequest[]>(fetchMyRequests, [], 30_000);

  return (
    <Screen title="My requests" description="Off-route trips you've asked for, newest first.">
      {requests.length === 0 ? (
        <Card>
          <EmptyState
            title="No requests yet"
            body="Trips to places off the regular loop show up here once you ask for one."
            action={
              <Link to="/request">
                <Button variant="accent">Request a ride</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className={styles.list}>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </Screen>
  );
}

const STATUS_TONE: Record<RideRequestStatus, 'live' | 'open' | 'muted' | 'accent'> = {
  scheduled: 'live',
  open: 'open',
  claimed: 'accent',
  expired: 'muted',
};

const STATUS_LABEL: Record<RideRequestStatus, string> = {
  scheduled: 'Scheduled',
  open: 'Open',
  claimed: 'Claimed',
  expired: 'Expired',
};

function RequestCard({ request }: { request: RideRequest }) {
  return (
    <Card>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <span className={styles.destination}>{request.destination}</span>
          <Badge tone={STATUS_TONE[request.status]}>
            {STATUS_LABEL[request.status]}
          </Badge>
        </div>
        <span className={styles.reference}>{request.reference}</span>
      </div>

      <p className={styles.detail}>
        Pickup {request.pickupLabel} · {formatDateTime(request.requestedAt)}
      </p>

      <p className={styles.status}>{statusLine(request)}</p>
    </Card>
  );
}

/** The one line explaining what actually happened to this request. */
function statusLine(request: RideRequest): string {
  switch (request.status) {
    case 'open':
      return 'Waiting for a driver to claim it.';
    case 'claimed':
      return 'A driver claimed it and is setting a time.';
    case 'scheduled':
      return request.schedule?.sentAt
        ? `Confirmation emailed at ${formatClock(request.schedule.sentAt)}.`
        : 'Scheduled. The confirmation email has not gone out yet.';
    case 'expired':
      return 'No driver was able to take it. Nothing was sent.';
  }
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
