import type { ReactNode } from 'react';
import styles from './Screen.module.css';

interface ScreenProps {
  title: string;
  description?: string;
  /** Right-aligned slot in the header — the service pill, total count. */
  action?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, description, action, children }: ScreenProps) {
  return (
    <section className={styles.screen}>
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
