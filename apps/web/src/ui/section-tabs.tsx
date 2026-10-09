// A section's tabs as links (09): Courses (My, Downloaded, Available), Review (Study, Decks, My words) —
// each tab its own address, the current one marked, a count where it says something.
import { Link } from "@tanstack/react-router";
import { cn } from "./utils.ts";

export interface SectionTab {
  to: string;
  label: string;
  count?: number;
  current: boolean;
}

export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab.current ? "page" : undefined}
          className={cn(
            // On a phone the count goes under the label, so three tabs fit in any language.
            "flex min-h-10 min-w-0 flex-1 flex-col items-center justify-center whitespace-nowrap rounded-lg px-1.5 text-[13px] leading-tight font-medium text-muted-foreground pointer-coarse:min-h-11 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm",
            tab.current && "bg-background text-foreground shadow-sm",
          )}
        >
          {tab.label}
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
