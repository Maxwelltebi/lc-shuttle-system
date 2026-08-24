import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type Tone = 'next' | 'accent' | 'live' | 'muted' | 'open' | 'count';

interface BadgeProps {
  tone?: Tone;
  /** Leading status dot, as on LIVE / OFFLINE / WAITING. */
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = 'muted', dot = false, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
