// Segmented choice: one of a few options, the selected one highlighted. Options that do not fit in a
// row (a phone, long labels) wrap and share the row's width, so no row ends in a gap.
import { cn } from "./utils.ts";

export function Choice({
  options,
  value,
  onChange,
  label,
  lead = false,
}: {
  options: Array<[string, React.ReactNode]>;
  value?: string;
  onChange(v: string): void;
  /** Names the group for assistive technology when no visible heading does. */
  label?: string;
  /** The first option stands apart (an exam's whole beside its modules): on a phone it takes a row of
   *  its own and the others go two to a row, so the rows come out even. */
  lead?: boolean;
}) {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        "min-w-0 gap-1 rounded-xl border bg-card p-1",
        lead ? "grid grid-cols-2 sm:inline-flex sm:flex-wrap" : "inline-flex flex-wrap",
      )}
    >
      {options.map(([v, text], i) => (
        <button
          type="button"
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-10 flex-auto rounded-lg px-2.5 pointer-coarse:min-h-11 sm:px-4",
            lead && i === 0 && "col-span-2",
            value === v ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}
