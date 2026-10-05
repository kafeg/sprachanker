// Segmented choice: one of a few options, the selected one highlighted.
import { cn } from "./utils.ts";

export function Choice({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value?: string;
  onChange(v: string): void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border bg-card p-1">
      {options.map(([v, label]) => (
        <button
          type="button"
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-10 rounded-lg px-4",
            value === v ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
