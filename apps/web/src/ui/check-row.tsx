// A setting turned on or off: a checkbox with its name and, under it, what it does — the whole row
// tappable.
import { Checkbox } from "./components/checkbox.tsx";
import { cn } from "./utils.ts";

export function CheckRow({
  checked,
  onChange,
  disabled,
  title,
  hint,
  className,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  title: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is inside
    <label
      className={cn(
        "flex min-h-11 items-center gap-3 py-2",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className="min-w-0">
        <span className="font-medium">{title}</span>
        {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
