// A plan's list (09): a lesson's steps, an exam run's questions — headings where a section begins,
// rows with their mark (ui/step-dot) and title, the one on screen highlighted and kept in sight.
import { useEffect, useRef } from "react";
import { cn } from "./utils.ts";

/** The list itself: keeps its row marked `aria-current="step"` in sight as `current` changes. */
export function PlanNav({
  current,
  label,
  children,
}: {
  current: unknown;
  label?: string;
  children: React.ReactNode;
}) {
  const nav = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the row on screen changes
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    nav.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [current]);
  return (
    <nav ref={nav} aria-label={label} className="space-y-0.5">
      {children}
    </nav>
  );
}

/** A section's title over its rows. */
export function PlanHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** A row: its mark, then its title; the one on screen highlighted. */
export function PlanRow({
  current,
  mark,
  label,
  onClick,
  children,
}: {
  current: boolean;
  mark: React.ReactNode;
  /** Its accessible name, when its text is not. */
  label?: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "step" : undefined}
      aria-label={label}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-accent pointer-coarse:min-h-11",
        current && "bg-accent font-semibold",
      )}
    >
      {mark}
      {children}
    </button>
  );
}
