/**
 * The app's mark: two people side by side, one a step ahead of the other.
 *
 * Three discs in a 64×64 viewBox, kept as data so the same shape renders in
 * the page, in `icon.svg`, in `favicon.ico` and in the PNGs that `next/og`
 * paints for the Open Graph image and the Apple touch icon. The middle disc
 * is drawn in the ink colour: it is the gap that lifts the front disc.
 */
export const MARK_DISCS = [
  { cx: 23, cy: 32, r: 12, part: "disc" },
  { cx: 41, cy: 32, r: 16, part: "gap" },
  { cx: 41, cy: 32, r: 12, part: "disc" },
] as const;

/** `--foreground` and `--background` from globals.css, as hex for image renderers. */
export const MARK_INK = "#0a0a0a";
export const MARK_PAPER = "#ffffff";

/** The discs with literal colours, for renderers that have no CSS (next/og). */
export function markDiscs(paper: string, ink: string) {
  return MARK_DISCS.map((d, i) => (
    <circle
      key={i}
      cx={d.cx}
      cy={d.cy}
      r={d.r}
      fill={d.part === "disc" ? paper : ink}
    />
  ));
}

export function BrandMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className={className}
    >
      <rect width="64" height="64" rx="14" className="fill-foreground" />
      {MARK_DISCS.map((d, i) => (
        <circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          className={d.part === "disc" ? "fill-background" : "fill-foreground"}
        />
      ))}
    </svg>
  );
}
