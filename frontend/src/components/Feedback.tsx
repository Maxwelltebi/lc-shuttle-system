import type { ReactNode } from 'react';
import styles from './Feedback.module.css';

/** Placeholder block shown while a request is in flight. */
export function Skeleton({
  width = '100%',
  height = 16,
}: {
  width?: string | number;
  height?: string | number;
}) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height, display: 'block' }}
      aria-hidden="true"
    />
  );
}

type NoticeTone = 'info' | 'warning' | 'error' | 'success';

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
}

/**
 * Inline message block. Carries the states the designs do not cover:
 *
 *  - `claim_conflict`  the other driver claimed it first
 *  - `email_failed`    the schedule was saved but not delivered
 *  - post-send confirmation
 *  - generic request failure
 */
export function Notice({ tone = 'info', title, children }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role="status">
      {title && <span className={styles.noticeTitle}>{title}</span>}
      <span>{children}</span>
    </div>
  );
}
