// One of a few options shown as a card (an engine reading aloud, the assistant's provider): its icon,
// name and a line on what it needs or has; the chosen one pressed and bordered.
import type { LucideIcon } from "lucide-react";
import { panelClass } from "./panel.tsx";
import { cn } from "./utils.ts";

export function OptionCard({
  icon: Icon,
  title,
  line,
  chosen,
  disabled = false,
  dim = false,
  onChoose,
}: {
  icon: LucideIcon;
  title: string;
  line: string;
  chosen: boolean;
  /** Cannot be chosen here (what it needs is missing). */
  disabled?: boolean;
  /** Shown fainter while not chosen (not installed, but still choosable). */
  dim?: boolean;
  onChoose(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      disabled={disabled}
      onClick={onChoose}
      className={cn(
        panelClass,
        "flex flex-col items-start gap-1 p-3 text-start hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60",
        chosen && "border-2 border-primary bg-accent",
        dim && !chosen && "opacity-60",
      )}
    >
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{line}</span>
    </button>
  );
}
