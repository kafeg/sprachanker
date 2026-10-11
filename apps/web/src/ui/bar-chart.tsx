// The Notebook's pictures (09): bars over time — days, weeks or months, oldest first along the reading
// direction (right to left mirrors them, as the calendar) — each of one or more parts stacked in their
// tones, its value in its title; the highest value marked at the top, the first and last bar's dates
// under them. And one bar across, of parts in their tones (a deck's words by state), with its legend.
import { cn } from "./utils.ts";

export interface ChartBar {
  key: string | number;
  /** The parts stacked from the bottom, in the order of the chart's tones. */
  parts: number[];
  /** What the bar holds, in words (its title). */
  title: string;
}

/** A legend's entries: a swatch in a part's tone and its name. */
export function ChartLegend({ items }: { items: Array<{ label: string; tone: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1">
          <span aria-hidden className={cn("size-2.5 rounded-sm", item.tone)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function BarChart({
  bars,
  tones,
  label,
  max,
  top,
  ends,
}: {
  bars: ChartBar[];
  /** Each part's fill. */
  tones: string[];
  /** What the picture shows, for a screen reader. */
  label: string;
  /** The value of a full bar (a share's 1); else the highest bar's. */
  max?: number;
  /** The full bar's value in words, at the top. */
  top: string;
  /** The first and the last bar's dates. */
  ends: [string, string];
}) {
  const highest = max ?? Math.max(0, ...bars.map((b) => b.parts.reduce((n, p) => n + p, 0)));
  return (
    <figure className="space-y-1">
      <div className="relative">
        <span className="absolute -top-0.5 start-0 text-[10px] leading-none text-muted-foreground tabular-nums">
          {top}
        </span>
        <div
          role="img"
          aria-label={label}
          className="flex h-24 items-end gap-px border-b border-t border-dashed border-t-border/60 pt-3"
        >
          {bars.map((bar) => (
            <div
              key={bar.key}
              title={bar.title}
              className="flex h-full min-w-0 flex-1 flex-col-reverse rounded-t-sm hover:bg-muted"
            >
              {bar.parts.map((part, i) =>
                part > 0 && highest > 0 ? (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: a part is its place in the stack.
                    key={i}
                    className={cn("block w-full last:rounded-t-sm", tones[i])}
                    style={{ height: `${(part / highest) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="flex justify-between text-[10px] text-muted-foreground">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </figcaption>
    </figure>
  );
}

/** One bar across, its parts in their tones side by side in proportion (none: an empty track). */
export function ShareBar({
  parts,
  label,
}: {
  parts: Array<{ value: number; tone: string; title: string }>;
  label: string;
}) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div role="img" aria-label={label} className="flex h-3 overflow-hidden rounded-full bg-muted">
      {total > 0 &&
        parts.map((p) =>
          p.value > 0 ? (
            <span
              key={p.title}
              title={p.title}
              className={p.tone}
              style={{ width: `${(p.value / total) * 100}%` }}
            />
          ) : null,
        )}
    </div>
  );
}
