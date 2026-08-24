import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  heading: string;
  subheading: string;
  children: ReactNode;
  /** Bottom line under the form — "Already registered? Sign in". */
  footnote?: ReactNode;
  aside: ReactNode;
}

/**
 * Two-panel auth frame. The dark panel is desktop-only; on mobile the
 * form fills the screen, matching mobile-design/03-login.
 */
export function AuthLayout({
  heading,
  subheading,
  children,
  footnote,
  aside,
}: AuthLayoutProps) {
  return (
    <div className={styles.layout}>
      <div className={styles.formSide}>
        <div className={styles.form}>
          <span className={styles.mark}>LC</span>
          <div>
            <h1 className={styles.heading}>{heading}</h1>
            <p className={styles.subheading}>{subheading}</p>
          </div>
          {children}
          {footnote && <p className={styles.footnote}>{footnote}</p>}
        </div>
      </div>

      <aside className={styles.aside}>
        <div className={styles.asideInner}>{aside}</div>
      </aside>
    </div>
  );
}

/** Numbered list in the dark panel on the sign-in screen. */
export function AsideSteps({
  heading,
  steps,
  meta,
}: {
  heading: string;
  steps: string[];
  meta: string;
}) {
  return (
    <>
      <h2 className={styles.asideHeading}>{heading}</h2>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step} className={styles.step}>
            <span className={styles.stepNumber}>{index + 1}</span>
            <span className={styles.stepText}>{step}</span>
          </li>
        ))}
      </ol>
      <p className={styles.asideMeta}>{meta}</p>
    </>
  );
}

/** Prose variant used on the sign-up screens. */
export function AsidePitch({
  heading,
  body,
  meta,
}: {
  heading: string;
  body: string;
  meta: string;
}) {
  return (
    <>
      <h2 className={styles.asideHeading}>{heading}</h2>
      <p className={styles.asideBody}>{body}</p>
      <p className={styles.asideMeta}>{meta}</p>
    </>
  );
}
