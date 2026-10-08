// A number with what it counts, in a small framed tile: a course's figures, the Notebook's totals.
// `note` under it in muted text; `alert` in the wrong colour (something missing).
import { cn } from "./utils.ts";

export function StatTile({
  value,
  label,
  note,
  alert,
  size = "md",
}: {
  value: string | number;
  label: string;
  note?: string;
  alert?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("rounded-xl border", size === "sm" ? "px-3 py-2" : "p-3")}>
      <p
        className={cn(
          "whitespace-nowrap font-semibold tabular-nums",
          size === "sm" ? "text-xl" : "text-2xl",
        )}
      >
        {value}
      </p>
      <p className={size === "sm" ? "text-xs text-muted-foreground" : "text-sm"}>{label}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {alert && <p className="text-xs text-wrong">{alert}</p>}
    </div>
  );
}
