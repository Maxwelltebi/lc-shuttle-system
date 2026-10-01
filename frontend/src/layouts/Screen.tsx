import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './Screen.module.css';

interface ScreenProps {
  title: string;
  description?: string;
  /** Right-aligned slot in the header — the service pill, total count. */
  action?: ReactNode;
  /**
   * Hub-and-spoke back link, rendered above the header. Mobile has no tab
   * bar, so every non-hub screen points back at the hub (Map for students,
   * Board for drivers). Hidden on desktop, where the sidebar covers it.
   */
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export function Screen({ title, description, action, backTo, backLabel, children }: ScreenProps) {
  return (
    <section className={styles.screen}>
      {backTo ? (
        <Link to={backTo} className={styles.backLink} aria-label={`Back to ${backLabel ?? 'home'}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m14 6-6 6 6 6" />
          </svg>
          {backLabel ?? 'Back'}
        </Link>
      ) : null}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {action}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
