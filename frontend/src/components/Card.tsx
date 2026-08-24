import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

type Tone = 'default' | 'live' | 'accent' | 'muted' | 'inverse' | 'highlighted';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  /** Off for cards that manage their own internal padding, such as
   *  list containers where rows carry the padding instead. */
  padded?: boolean;
  children: ReactNode;
}

export function Card({
  tone = 'default',
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    styles.card,
    tone !== 'default' ? styles[tone] : '',
    padded ? styles.padded : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
