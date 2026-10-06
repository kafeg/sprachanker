// Placing chips into slots (matching, word banks): drag a chip onto a slot with mouse, finger or
// keyboard (dnd-kit), or tap a chip and then a slot. A tap on a filled slot gives its chip back.
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/ui/utils.ts";

/** The area chips are dragged in; `onDrop` gets the chip and the slot it was dropped on. */
export function DragBoard({
  onDrop,
  children,
}: {
  onDrop(chip: string, slot: string): void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // A short move before a drag starts, so a tap stays a tap and a page can still be scrolled.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={(e) => e.over && onDrop(String(e.active.id), String(e.over.id))}
    >
      {children}
    </DndContext>
  );
}

export function Chip({
  id,
  selected,
  disabled,
  onTap,
  children,
  className,
}: {
  id: string;
  /** Picked by a tap: the next tap on a slot places it. */
  selected?: boolean;
  disabled?: boolean;
  onTap(): void;
  children: React.ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onTap}
      className={cn(
        "inline-flex min-h-11 touch-none items-center rounded-xl border-2 bg-card px-3 text-lg",
        "cursor-grab select-none active:cursor-grabbing disabled:cursor-default",
        selected && "border-primary bg-primary/15",
        isDragging && "z-20 shadow-lg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Slot({
  id,
  label,
  filled,
  active,
  mark,
  disabled,
  onTap,
  children,
  className,
}: {
  id: string;
  /** What the slot is for, for screen readers. */
  label: string;
  filled: boolean;
  /** A chip is picked and this slot would take it. */
  active?: boolean;
  mark?: "correct" | "wrong";
  disabled?: boolean;
  onTap(): void;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <button
      type="button"
      ref={setNodeRef}
      aria-label={label}
      disabled={disabled}
      onClick={onTap}
      className={cn(
        "flex min-h-11 items-center justify-center rounded-xl border-2 px-3 text-lg",
        filled ? "border-solid bg-card" : "border-dashed text-muted-foreground",
        (isOver || active) && !mark && "border-primary bg-primary/10",
        mark === "correct" && "border-correct bg-correct-soft",
        mark === "wrong" && "border-wrong bg-wrong-soft",
        className,
      )}
    >
      {children}
    </button>
  );
}
