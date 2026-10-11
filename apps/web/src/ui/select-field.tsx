// One value of a list chosen in a labelled select: the label above, a tall trigger on the card's colour
// named by it, an option a row — the Courses tabs' filters, a deck's languages, a tutor chat's language.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/select.tsx";
import { cn } from "./utils.ts";

export function SelectField({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  /** Each option's value and what its row shows. */
  options: Array<[string, React.ReactNode]>;
  onChange(value: string): void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {/* A value set while the list is closed comes back once as "" from a form's select: kept. */}
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="h-11 w-full bg-card" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, shown]) => (
            <SelectItem key={v} value={v}>
              {shown}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
