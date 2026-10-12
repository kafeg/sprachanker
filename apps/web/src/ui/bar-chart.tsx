// The Notebook's pictures: bars over time — days, weeks or months, oldest first along the reading
// direction (right to left mirrors them, as the calendar) — each of one or more parts stacked in their
// tones; the highest value marked at the top, the first and last bar's dates under them. Each bar is a
// button named by what it holds: pointed at, tapped or focused (one tab stop, the arrow keys along the
// reading direction), what it holds is shown under the bars in place of the dates — on a phone too. A
// value of nothing that is one (0 % remembered) is a mark on the baseline, unlike a bar with nothing to
// tell. And one bar across, of parts in their tones (a deck's words by state), with its legend.
import { useRef, useState } from "react";
import { arrowStep } from "./direction.tsx";
import { cn } from "./utils.ts";

export interface ChartBar {
  key: string | number;
  /** The parts stacked from the bottom, in the order of the chart's tones. */
  parts: number[];
  /** What the bar holds, in words: its name, and the line shown when it is chosen. */
  title: string;
  /** Nothing that is a value (a share of 0 %): a mark on the baseline. */
  zero?: boolean;
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
  /** What the picture shows: its name. */
  label: string;
  /** The value of a full bar (a share's 1); else the highest bar's. */
  max?: number;
  /** The full bar's value in words, at the top. */
  top: string;
  /** The first and the last bar's dates. */
  ends: [string, string];
}) {
  const highest = max ?? Math.max(0, ...bars.map((b) => b.parts.reduce((n, p) => n + p, 0)));
  // The bar whose value is shown (by its key: the span may change under it); the latest is the one
  // tab stop while none is.
  const [chosenKey, setChosenKey] = useState<ChartBar["key"] | null>(null);
  const chosen = bars.findIndex((b) => b.key === chosenKey);
  const choose = (i: number | null) => setChosenKey(i === null ? null : (bars[i]?.key ?? null));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const stop = chosen < 0 ? bars.length - 1 : chosen;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = arrowStep(e.key);
    const to = e.key === "Home" ? 0 : e.key === "End" ? bars.length - 1 : stop + step;
    if ((!step && e.key !== "Home" && e.key !== "End") || to < 0 || to >= bars.length) return;
    e.preventDefault();
    choose(to);
    buttons.current[to]?.focus();
  };
  return (
    <figure aria-label={label} className="space-y-1">
      <div className="relative">
        <span
          aria-hidden
          className="absolute -top-0.5 start-0 text-[10px] leading-none text-muted-foreground tabular-nums"
        >
          {top}
        </span>
        <div
          className="flex h-24 items-end gap-px border-b border-t border-dashed border-t-border/60 pt-3"
          onPointerLeave={(e) => e.pointerType === "mouse" && choose(null)}
        >
          {bars.map((bar, i) => (
            <button
              key={bar.key}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              aria-label={bar.title}
              tabIndex={i === stop ? 0 : -1}
              onClick={() => choose(i)}
              onFocus={() => choose(i)}
              onPointerEnter={(e) => e.pointerType === "mouse" && choose(i)}
              onKeyDown={onKeyDown}
              className={cn(
                "flex h-full min-w-0 flex-1 flex-col-reverse rounded-t-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                chosen === i && "bg-muted",
              )}
            >
              {bar.zero && <span className="block h-0.5 w-full bg-wrong" />}
              {bar.parts.map((part, p) =>
                part > 0 && highest > 0 ? (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: a part is its place in the stack.
                    key={p}
                    className={cn("block w-full last:rounded-t-sm", tones[p])}
                    style={{ height: `${(part / highest) * 100}%` }}
                  />
                ) : null,
              )}
            </button>
          ))}
        </div>
      </div>
      {/* The chosen bar's value, or the first and last bar's dates. */}
      <figcaption
        aria-hidden
        className="flex min-h-4 justify-between gap-2 text-xs text-muted-foreground"
      >
        {chosen >= 0 ? (
          <span className="text-foreground">{bars[chosen]?.title}</span>
        ) : (
          <>
            <span>{ends[0]}</span>
            <span>{ends[1]}</span>
          </>
        )}
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
