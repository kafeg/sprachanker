// Segmented choice: one of a few options, the selected one highlighted. Options that do not fit in a
// row (a phone, long labels) wrap and share the row's width, so no row ends in a gap.
import { cn } from "./utils.ts";

export function Choice({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<[string, React.ReactNode]>;
  value?: string;
  onChange(v: string): void;
  /** Names the group for assistive technology when no visible heading does. */
  label?: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="inline-flex min-w-0 flex-wrap gap-1 rounded-xl border bg-card p-1"
    >
      {options.map(([v, text]) => (
        <button
          type="button"
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-10 flex-auto rounded-lg px-4 pointer-coarse:min-h-11",
            value === v ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}
