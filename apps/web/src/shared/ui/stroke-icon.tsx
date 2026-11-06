interface StrokeIconProps {
  /** SVG path "d" attribute on a 24×24 grid. */
  path: string;
  size?: number;
  strokeWidth?: number;
}

/** Decorative line icon; always hidden from assistive technology (pair it with visible text). */
export function StrokeIcon({ path, size = 18, strokeWidth = 1.8 }: StrokeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
