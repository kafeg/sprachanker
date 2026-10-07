// A bordered panel on a page (a step's task, a result, a list), with an optional heading.
import { cn } from "./utils.ts";

export function Panel({
  title,
  as: Tag = "section",
  className,
  children,
}: {
  title?: React.ReactNode;
  as?: "section" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag className={cn("rounded-2xl border bg-card p-4 sm:p-5", className)}>
      {title && <h3 className="mb-1 font-semibold">{title}</h3>}
      {children}
    </Tag>
  );
}
