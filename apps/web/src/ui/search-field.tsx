// A page's search field (My words, an exam's catalogue): one look, a touch target's height.
import { Input } from "./components/input.tsx";
import { cn } from "./utils.ts";

export function SearchField({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      type="search"
      className={cn("h-11 rounded-xl bg-card px-4 text-base md:text-base dark:bg-card", className)}
      {...props}
    />
  );
}
