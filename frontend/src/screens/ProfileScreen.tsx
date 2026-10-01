import { Button, Card } from '../components';
import { useMyBus } from '../hooks/useMyBus';
import { useSession } from '../hooks/useSession';
import { useStops } from '../hooks/useStops';
import { Screen } from '../layouts/Screen';
import styles from './ProfileScreen.module.css';

/**
 * Profile — the one place sign-out lives on every form factor.
 *
 * On desktop the sidebar also has a sign-out button, but on mobile the
 * sidebar does not exist, so this screen is the canonical exit. It shows
 * who is signed in (name, email, role meta) and nothing else.
 */
export function ProfileScreen() {
  const { user, endSession } = useSession();
  const stops = useStops();
  const { bus } = useMyBus();

  if (!user) return null;

  const homeStopName =
    user.role === 'student' && user.homeStopId
      ? (stops.find((stop) => stop.id === user.homeStopId)?.name ?? 'No usual stop set')
      : null;

  const meta =
    user.role === 'driver'
      ? (bus?.label ? `${bus.label} · driver` : 'Driver')
      : (homeStopName ?? 'No usual stop set');

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <Screen
      title="Profile"
      description="Your account on this device."
      backTo={user.role === 'driver' ? '/board' : '/map'}
      backLabel={user.role === 'driver' ? 'Board' : 'Map'}
    >
      <div className={styles.wrap}>
        <Card>
          <div className={styles.head}>
            <span className={styles.avatar} aria-hidden>
              {initials}
            </span>
            <div>
              <p className={styles.name}>
                {user.firstName} {user.lastName}
              </p>
              <p className={styles.meta}>{meta}</p>
            </div>
          </div>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div className={styles.row}>
              <dt>Role</dt>
              <dd>{user.role === 'driver' ? 'Driver' : 'Student'}</dd>
            </div>
            {user.role === 'student' && (
              <div className={styles.row}>
                <dt>Usual stop</dt>
                <dd>{homeStopName}</dd>
              </div>
            )}
            {user.role === 'driver' && (
              <div className={styles.row}>
                <dt>Bus</dt>
                <dd>{bus?.label ?? 'Not assigned'}</dd>
              </div>
            )}
          </dl>
          <div className={styles.actions}>
            <Button variant="outline" onClick={endSession}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
