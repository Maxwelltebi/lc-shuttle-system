import styles from './Toggle.module.css';
import { Spinner } from './Spinner';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** "On duty" / "Off duty" — the label changes with state. */
  label: string;
  /** "Students can see Bus 1 on the map." */
  description?: string;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * The driver's on-duty switch. The single most consequential control in
 * the app: off means no student sees this bus at all.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  loading = false,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || loading}
      aria-busy={loading}
      className={styles.wrap}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.copy}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      {loading && <Spinner />}
      <span className={`${styles.track} ${checked ? styles.on : ''}`}>
        <span className={styles.knob} />
      </span>
    </button>
  );
}
