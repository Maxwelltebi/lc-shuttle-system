import styles from './Toggle.module.css';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** "On duty" / "Off duty" — the label changes with state. */
  label: string;
  /** "Students can see Bus 1 on the map." */
  description?: string;
  disabled?: boolean;
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
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={styles.wrap}
      onClick={() => onChange(!checked)}
    >
      <span>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      <span className={`${styles.track} ${checked ? styles.on : ''}`}>
        <span className={styles.knob} />
      </span>
    </button>
  );
}
