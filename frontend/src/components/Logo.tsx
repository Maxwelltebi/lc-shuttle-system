interface LogoProps {
  /** Display size in px; the seal is near-square. Defaults to 34. */
  size?: number;
  className?: string;
}

/**
 * Livingstone College seal, served from public/. Same file backs the
 * favicon (see index.html), so the tab icon and every in-app logo are
 * one file and can never drift apart.
 */
export function Logo({ size = 34, className }: LogoProps) {
  return (
    <img
      src="/lc.svg"
      alt="Livingstone College"
      width={size}
      height={size}
      className={className}
    />
  );
}
