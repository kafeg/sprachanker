// Lists of earlier items and rows that open something (09): the whole row is the button, a chevron says
// whether it opens a page (right) or unfolds in place (down). A history shows one item at a time.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Panel } from "./panel.tsx";
import { cn } from "./utils.ts";

/** A row that opens something: `expanded` for one that unfolds in place; `chevron={false}` in a table;
 *  `flush` where nothing pads it (a table, a bordered box): its highlight stays inside. */
export function ListRow({
  onClick,
  expanded,
  chevron = true,
  flush = false,
  className,
  children,
}: {
  onClick(): void;
  expanded?: boolean;
  chevron?: boolean;
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = expanded === undefined ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 py-2.5 text-start hover:bg-accent pointer-coarse:min-h-11",
        // In a panel the highlight reaches past the text on both sides, the text in line with the
        // panel's; flush, it fills the row it is in.
        flush ? "w-full px-4" : "-mx-3 w-[calc(100%+1.5rem)] rounded-xl px-3",
        className,
      )}
    >
      {children}
      {chevron && (
        <Icon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-180",
            expanded === undefined && "rtl:-scale-x-100",
          )}
        />
      )}
    </button>
  );
}

/** Which one item of a list is open, if any; opening another closes it. */
export function useSingleOpen<K>() {
  const [open, setOpen] = useState<K>();
  return {
    isOpen: (key: K) => open === key,
    toggle: (key: K) => setOpen(open === key ? undefined : key),
  };
}

/** A titled list of earlier items (scenes, texts), newest first; a row unfolds to the item in full. */
export function HistoryList<T>({
  title,
  items,
  keyOf,
  summary,
  detail,
}: {
  /** Its heading (none where the panel names it already, e.g. a tab). */
  title?: React.ReactNode;
  items: T[];
  keyOf(item: T): string | number;
  summary(item: T): React.ReactNode;
  detail(item: T): React.ReactNode;
}) {
  const open = useSingleOpen<string | number>();
  if (!items.length) return null;
  return (
    <Panel title={title}>
      <ul className="divide-y">
        {items.map((item) => {
          const key = keyOf(item);
          return (
            <li key={key}>
              <ListRow expanded={open.isOpen(key)} onClick={() => open.toggle(key)}>
                <span className="min-w-0 flex-1">{summary(item)}</span>
              </ListRow>
              {open.isOpen(key) && <div className="space-y-3 pt-1 pb-4">{detail(item)}</div>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
