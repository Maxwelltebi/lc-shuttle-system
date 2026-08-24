import type { ServiceState } from '../types';
import styles from './StatusPill.module.css';

interface StatusPillProps {
  state: ServiceState;
  /** "1:15 PM" — appended when the service is not currently running. */
  nextDepartureClock?: string | null;
}

const LABELS: Record<ServiceState, string> = {
  in_service: 'In service',
  lunch_break: 'No service',
  closed: 'No service',
};

/** Top-right of the student map: whether anything is running right now. */
export function StatusPill({ state, nextDepartureClock }: StatusPillProps) {
  const suffix =
    state !== 'in_service' && nextDepartureClock
      ? ` — next departure ${nextDepartureClock}`
      : '';

  return (
    <span className={`${styles.pill} ${styles[state]}`}>
      {LABELS[state]}
      {suffix}
    </span>
  );
}
