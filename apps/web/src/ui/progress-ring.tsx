// A share as a ring with a text inside (the course map's lessons done, an exam's readiness or score).
import { cn } from "./utils.ts";

/** The ring's colour and its track's. */
const TONE = {
  primary: ["stroke-primary", "stroke-primary/20"],
  correct: ["stroke-correct", "stroke-correct/20"],
  wrong: ["stroke-wrong", "stroke-wrong/20"],
} as const;

export function ProgressRing({
  value,
  text,
  tone = "primary",
  className,
}: {
  /** 0..1 */
  value: number;
  /** What the ring says inside (a percentage, "24/33"). */
  text: string;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const r = 30;
  const length = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 76 76"
      className={cn("size-16 shrink-0 sm:size-20", className)}
      role="img"
      aria-label={text}
    >
      <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" className={TONE[tone][1]} />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${Math.min(1, Math.max(0, value)) * length} ${length}`}
        transform="rotate(-90 38 38)"
        className={TONE[tone][0]}
      />
      <text
        x="38"
        y="43"
        textAnchor="middle"
        className={cn(
          "fill-foreground font-semibold",
          text.length > 5 ? "text-[13px]" : "text-[15px]",
        )}
      >
        {text}
      </text>
    </svg>
  );
}
