import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge } from '../components';
import {
  IconInbox,
  IconList,
  IconMap,
  IconPeople,
  IconPin,
  IconPlus,
  IconPower,
} from '../components/Icon';
import type { CurrentUser } from '../types';
import { useMyBus } from '../hooks/useMyBus';
import { useStops } from '../hooks/useStops';
import styles from './AppShell.module.css';

export interface NavEntry {
  to: string;
  label: string;
  /** Short label for the mobile tab bar, where space is tighter. */
  shortLabel?: string;
  icon: (props: { size?: number }) => ReactNode;
  /** Live count badge. Hidden at zero — an empty board should not shout. */
  count?: number;
}

export const STUDENT_NAV: NavEntry[] = [
  { to: '/map', label: 'Map', icon: IconMap },
  { to: '/waiting', label: 'Waiting', icon: IconPin },
  { to: '/request', label: 'Request', icon: IconPlus },
  { to: '/trips', label: 'My trips', icon: IconList },
];

export const DRIVER_NAV: NavEntry[] = [
  { to: '/duty', label: 'On duty', icon: IconPower },
  { to: '/board', label: 'Board', icon: IconPeople },
  { to: '/queue', label: 'Queue', icon: IconInbox },
];

interface AppShellProps {
  nav: NavEntry[];
  user: CurrentUser | null;
  onSignOut: () => void;
}

function initials(user: CurrentUser) {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}

/** Secondary line under the user's name: their stop, or their bus. */
function userMeta(user: CurrentUser, stopName: string | null, busLabel: string | null) {
  if (user.role === 'driver') {
    /* The label ("Bus 2"), never user.busId — that is a raw ObjectId,
       which meant the sidebar was printing a 24-character hex string. */
    return busLabel ? `${busLabel} · driver` : 'Driver';
  }
  return stopName ?? 'No usual stop set';
}

export function AppShell({ nav, user, onSignOut }: AppShellProps) {
  const stops = useStops();
  const { bus } = useMyBus();

  /* The sidebar shows a student's usual stop by name. Passing null here
     was making every student read "No usual stop set" even when they had
     chosen one at sign-up. */
  const homeStopName =
    user?.role === 'student' && user.homeStopId
      ? (stops.find((stop) => stop.id === user.homeStopId)?.name ?? null)
      : null;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.mark}>LC</span>
          <span className={styles.wordmark}>Shuttle</span>
        </div>

        <nav className={styles.nav}>
          {nav.map(({ to, label, icon: Icon, count }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <Icon size={20} />
              <span className={styles.navLabel}>{label}</span>
              {count ? <Badge tone="count">{count}</Badge> : null}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className={styles.user}>
            <span className={styles.avatar}>{initials(user)}</span>
            <span className={styles.userText}>
              <span className={styles.userName}>
                {user.firstName} {user.lastName}
              </span>
              <br />
              <span className={styles.userMeta}>
                {userMeta(user, homeStopName, bus?.label ?? null)}
              </span>
            </span>
            <button type="button" className={styles.signOut} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.tabbar}>
        {nav.map(({ to, label, shortLabel, icon: Icon, count }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.tab} ${isActive ? styles.tabActive : ''}`
            }
          >
            <span style={{ position: 'relative' }}>
              <Icon size={22} />
              {count ? (
                <span className={styles.tabBadge}>
                  <Badge tone="count">{count}</Badge>
                </span>
              ) : null}
            </span>
            {shortLabel ?? label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
