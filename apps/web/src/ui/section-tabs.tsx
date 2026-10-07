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
            "flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted-foreground pointer-coarse:min-h-11",
            tab.current && "bg-background text-foreground shadow-sm",
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="tabular-nums text-muted-foreground">{tab.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
