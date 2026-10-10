// A page with a side column (09): the column beside the content on a wide screen, in a sheet from the
// header's button on a phone; a sticky header over the content. The lesson player and an exam run
// share it — their plan (steps, questions) is the column.
import { ListOrdered } from "lucide-react";
import { useState } from "react";
import { Button } from "./components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/sheet.tsx";
import { cn } from "./utils.ts";

export function SideLayout({
  side,
  sideLabel,
  bar,
  width = "max-w-3xl",
  children,
}: {
  /** The column; `picked` closes the phone's sheet once something in it is chosen. */
  side(picked?: () => void): React.ReactNode;
  /** The column's name: its button on a phone, the sheet's title. */
  sideLabel: string;
  /** The header after the column's button. */
  bar: React.ReactNode;
  /** The content's width. */
  width?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-r p-4 lg:block">
        {side()}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className={cn("mx-auto flex items-center gap-2 px-4 py-2", width)}>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={sideLabel}
              onClick={() => setOpen(true)}
            >
              <ListOrdered className="size-5" />
            </Button>
            {bar}
          </div>
        </header>
        <div className={cn("mx-auto px-4 py-6", width)}>{children}</div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto p-4">
          <SheetHeader className="sr-only p-0">
            <SheetTitle>{sideLabel}</SheetTitle>
          </SheetHeader>
          {side(() => setOpen(false))}
        </SheetContent>
      </Sheet>
    </div>
  );
}
