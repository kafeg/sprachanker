// The two buttons of a step bar, one look for the lesson's steps and an exam run's questions: Back
// quiet (an arrow on a phone, so the bar keeps to one row), the main one primary with a fixed width.
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
      <ArrowLeft className="size-5 sm:hidden" />
      <span className="max-sm:sr-only">{label}</span>
    </Button>
  );
}

export function StepNext({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button size="lg" className={cn("w-32 text-base sm:w-40", className)} {...props} />;
}
