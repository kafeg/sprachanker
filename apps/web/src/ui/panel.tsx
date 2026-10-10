// A bordered panel on a page (a step's task, a result, a list), with an optional heading.
import { cn } from "./utils.ts";

/** The panel's look without its padding: lists, folded sections and cards that pad themselves. */
export const panelClass = "rounded-2xl border bg-card";

export function Panel({
  id,
  title,
  as: Tag = "section",
  className,
  children,
}: {
  /** Where an address may lead (Settings' #about). */
  id?: string;
  title?: React.ReactNode;
  as?: "section" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag id={id} className={cn(panelClass, "p-4 sm:p-5", className)}>
      {title && <h3 className="mb-1 font-semibold">{title}</h3>}
      {children}
    </Tag>
  );
}
