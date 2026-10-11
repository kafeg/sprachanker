// The two buttons of a step bar, one look for the lesson's steps and an exam run's questions: Back
// quiet (an arrow on a phone, so the bar keeps to one row), the main one primary (an exam's Next
// outlined while its question is unanswered) and at least a fixed width, so Check becomes Next under
// the finger; a longer label widens it, on a phone it wraps to a second line rather than spill.
import { ArrowLeft } from "lucide-react";
import { Button } from "./components/button.tsx";
import { cn } from "./utils.ts";

export function StepBack({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="max-sm:px-3"
    >
      <ArrowLeft className="rtl:-scale-x-100 size-5 sm:hidden" />
      <span className="max-sm:sr-only">{label}</span>
    </Button>
  );
}

export function StepNext({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size="lg"
      className={cn(
        "min-w-32 text-base sm:min-w-40 max-sm:h-auto max-sm:min-h-10 max-sm:shrink max-sm:whitespace-normal max-sm:px-4 max-sm:py-1.5 max-sm:leading-tight",
        className,
      )}
      {...props}
    />
  );
}
