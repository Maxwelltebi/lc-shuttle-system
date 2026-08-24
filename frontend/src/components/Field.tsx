import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import styles from './Field.module.css';

interface BaseProps {
  label: string;
  /** Field-level message from ApiError.fields. */
  error?: string;
  hint?: string;
}

type TextFieldProps = BaseProps & InputHTMLAttributes<HTMLInputElement>;

export function TextField({ label, error, hint, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`${styles.control} ${error ? styles.invalid : ''}`}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error && <span className={styles.error}>{error}</span>}
      {!error && hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

type SelectFieldProps = BaseProps &
  SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode };

export function SelectField({
  label,
  error,
  hint,
  children,
  ...rest
}: SelectFieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={`${styles.control} ${error ? styles.invalid : ''}`}
        aria-invalid={Boolean(error)}
        {...rest}
      >
        {children}
      </select>
      {error && <span className={styles.error}>{error}</span>}
      {!error && hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

/** Two fields side by side — first/last name, date/time. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
