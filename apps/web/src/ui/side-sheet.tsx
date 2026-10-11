// A side panel over the page (a conversation, a word): full width on a phone.
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/sheet.tsx";
import { cn } from "./utils.ts";

export function SideSheet({
  open,
  onOpenChange,
  title,
  className,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** The panel's width and scrolling, when not the conversation's (`sm:max-w-lg`). */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className={cn("w-full gap-0 sm:max-w-lg", className)}>
        <SheetHeader className="pb-2">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
