import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'accent' | 'outline' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Full width — every mobile action button in the designs. */
  block?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    block ? styles.block : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} {...rest} disabled={disabled || loading} aria-busy={loading}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}
