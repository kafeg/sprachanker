// A section's tabs (09), one look for both kinds: as links — Courses (My, Downloaded, Available), Review
// (Study, Decks, My words), each tab its own address, a count where it says something — and as tabs on
// one page (Settings: SectionTabList inside a Tabs). One row sharing its width; a tab is never narrower
// than its label: tabs that do not fit scroll sideways, the open one kept in sight.
import { Link } from "@tanstack/react-router";
import { Tabs as TabsPrimitive } from "radix-ui";
import { useEffect, useRef } from "react";
import { cn } from "./utils.ts";

const BAR = "relative mb-6 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1";
const TAB = cn(
  "flex min-h-10 flex-1 flex-col items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-[13px] leading-tight font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm",
  // The current tab: a link's page, a tab's selection.
  "aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm",
  "aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm",
);

interface SectionTab {
  to: string;
  label: string;
  count?: number;
  current: boolean;
}

export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  return (
    <nav className={BAR} aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          // The router marks a link current by prefix (/review under /review/decks): exactly, here.
          activeOptions={{ exact: true, includeSearch: false }}
          aria-current={tab.current ? "page" : undefined}
          className={TAB}
        >
          {tab.label}
          {/* On a phone the count goes under the label, so three tabs fit in any language. */}
          {tab.count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground sm:text-sm">
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** The tabs of a page's own `Tabs` (ui/components/tabs), looking as SectionTabs. */
export function SectionTabList({
  label,
  value,
  tabs,
  className,
}: {
  label: string;
  /** The open tab, scrolled into sight when the bar scrolls. */
  value: string;
  tabs: Array<{ value: string; label: string }>;
  /** Its margins, when not a page's (`mb-6`). */
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const labels = tabs.map((tab) => tab.label).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolled when the open tab or the labels change
  useEffect(() => {
    // Again once the fonts are in: the labels' widths change with them (and with the language).
    const show = () => {
      const list = bar.current;
      const open = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (list && open)
        list.scrollLeft = open.offsetLeft - (list.clientWidth - open.offsetWidth) / 2;
    };
    show();
    void document.fonts?.ready.then(show);
  }, [value, labels]);
  return (
    <TabsPrimitive.List ref={bar} className={cn(BAR, className)} aria-label={label}>
      {tabs.map((tab) => (
        <TabsPrimitive.Trigger key={tab.value} value={tab.value} className={TAB}>
          {tab.label}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );
}
