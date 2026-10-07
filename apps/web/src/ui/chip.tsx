// A filter that is on or off (My words: a deck, a state).
import { cn } from "./utils.ts";

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm pointer-coarse:min-h-11",
        on ? "border-primary bg-primary/15 font-medium" : "text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
