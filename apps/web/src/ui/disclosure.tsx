// What is rarely needed, folded under its title ("Advanced"): a line with a chevron that opens what is
// under it. An address naming its `id` opens it (the settings page does).
import { ChevronRight } from "lucide-react";
import { cn } from "./utils.ts";

export function Disclosure({
  title,
  id,
  className,
  children,
}: {
  title: React.ReactNode;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id} className={cn("group", className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg pr-2 font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {title}
      </summary>
      <div className="mt-3 space-y-6">{children}</div>
    </details>
  );
}
