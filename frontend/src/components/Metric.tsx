import styles from './Metric.module.css';

interface MetricProps {
  value: number;
  /** "students waiting" — singularised automatically. */
  noun: string;
}

export function Metric({ value, noun }: MetricProps) {
  const label = value === 1 ? noun.replace(/s$/, '') : noun;
  return (
    <p className={styles.wrap}>
      <span className={`${styles.value} ${value === 0 ? styles.zero : ''}`}>
        {value}
      </span>
      <span className={styles.label}>{label}</span>
    </p>
  );
}
