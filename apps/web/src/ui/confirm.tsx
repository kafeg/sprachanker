// A confirmation for an action that cannot be undone (resetting progress): what will happen, Cancel,
// and the action (none while it cannot be done: `hideConfirm`, the reason said instead). Built on Radix AlertDialog, so focus starts on Cancel and Escape cancels.
// ConfirmButton: a button whose action is asked first.
import { AlertDialog } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button } from "@/ui/components/button.tsx";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  cancel,
  busy,
  hideConfirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: string;
  /** Label of the action. */
  confirm: string;
  cancel: string;
  busy?: boolean;
  hideConfirm?: boolean;
  onConfirm(): void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" size="lg">
                {cancel}
              </Button>
            </AlertDialog.Cancel>
            {!hideConfirm && (
              <Button
                variant="destructive"
                size="lg"
                loading={busy}
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
              >
                {confirm}
              </Button>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** A small button whose action is asked first; the dialog closes once the action is done (`onConfirm`
 *  is handed the way to close it). */
export function ConfirmButton({
  children,
  onConfirm,
  ...dialog
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirm: string;
  cancel: string;
  busy?: boolean;
  onConfirm(close: () => void): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        {...dialog}
        open={open}
        onOpenChange={setOpen}
        onConfirm={() => onConfirm(() => setOpen(false))}
      />
    </>
  );
}
