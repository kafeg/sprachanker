// A page with a side column: the column beside the content on a wide screen, in a sheet from the
// header's button on a phone; a sticky header over the content. The lesson player and an exam run
// share it — their plan (steps, questions) is the column.
import { ListOrdered } from "lucide-react";
import { useState } from "react";
import { Button } from "./components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/sheet.tsx";
import { cn } from "./utils.ts";

/** The way back out of the column's page (a link or a button: the caller's, given this class). */
export const SIDE_BACK =
  "me-8 mb-3 flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 lg:me-0";

/** The column's head: the way back, the title, how far it is. */
export function SideHeader({
  back,
  title,
  status,
}: {
  /** The way back, drawn with `SIDE_BACK`. */
  back: React.ReactNode;
  title: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <>
      {back}
      <h2 className="mb-1 px-2 text-xl font-bold">{title}</h2>
      <p className="mb-3 px-2 text-sm text-muted-foreground">{status}</p>
    </>
  );
}

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
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-e p-4 lg:block">
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
        <SheetContent side="start" className="w-80 overflow-y-auto p-4">
          <SheetHeader className="sr-only p-0">
            <SheetTitle>{sideLabel}</SheetTitle>
          </SheetHeader>
          {side(() => setOpen(false))}
        </SheetContent>
      </Sheet>
    </div>
  );
}
