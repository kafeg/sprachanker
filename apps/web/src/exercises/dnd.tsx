// Placing chips (matching, word banks, putting parts in order): drag a chip onto a slot, a zone or
// another chip with mouse, finger or keyboard (dnd-kit), or tap a chip and then a slot. A tap on a
// filled slot gives its chip back.
import {
  type Announcements,
  type CollisionDetection,
  type DataRef,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";

/**
 * The innermost target under the pointer (a chip in a line before the line around it); without a
 * pointer (keyboard) the one the dragged chip overlaps most.
 */
const innermost: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (!hits.length) return rectIntersection(args);
  const area = (id: string | number) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  return hits.sort((a, b) => area(a.id) - area(b.id));
};

/** What chips and places are called in screen-reader announcements. */
type Named = { label?: string };

/** The area chips are dragged in; `onDrop` gets the chip and the slot it was dropped on. */
export function DragBoard({
  onDrop,
  children,
}: {
  onDrop(chip: string, slot: string): void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const name = (x: { data: DataRef<Named> } | null) => x?.data.current?.label || t("ex.dnd.item");
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("ex.dnd.start", { item: name(active) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("ex.dnd.over", { item: name(active), place: name(over) })
        : t("ex.dnd.away", { item: name(active) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t("ex.dnd.end", { item: name(active), place: name(over) })
        : t("ex.dnd.cancel", { item: name(active) }),
    onDragCancel: ({ active }) => t("ex.dnd.cancel", { item: name(active) }),
  };
  const sensors = useSensors(
    // A short move before a drag starts, so a tap stays a tap and a page can still be scrolled.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={innermost}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("ex.dnd.instructions") },
      }}
      onDragEnd={(e) => e.over && onDrop(String(e.active.id), String(e.over.id))}
    >
      {children}
    </DndContext>
  );
}

export function Chip({
  id,
  label,
  dropId,
  selected,
  disabled,
  onTap,
  children,
  className,
}: {
  id: string;
  /** Its text, for screen-reader announcements (a picture has none). */
  label?: string;
  /** Other chips can be dropped on this one (reordering a line): the drop target's id. */
  dropId?: string;
  /** Picked by a tap: the next tap on a slot places it. */
  selected?: boolean;
  disabled?: boolean;
  onTap(): void;
  children: React.ReactNode;
  className?: string;
}) {
  const data: Named = { label };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
    data,
  });
  const drop = useDroppable({ id: dropId ?? `${id}:drop`, disabled: disabled || !dropId, data });
  return (
    <button
      type="button"
      ref={(node) => {
        setNodeRef(node);
        drop.setNodeRef(node);
      }}
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
        drop.isOver && !isDragging && "border-s-primary border-s-4",
        isDragging && "relative z-20 shadow-lg",
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
  style,
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
  style?: React.CSSProperties;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled, data: { label } satisfies Named });
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      aria-label={label}
      disabled={disabled}
      onClick={onTap}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 text-lg",
        // A chip in it reads from the left, its lines even (no word alone on the last), the mark at
        // the end; an empty one says where to drop, centred.
        filled
          ? "justify-between border-solid bg-card text-start text-balance"
          : "justify-center border-dashed text-muted-foreground",
        (isOver || active) && !mark && "border-primary bg-primary/10",
        mark === "correct" && "border-correct bg-correct-soft",
        mark === "wrong" && "border-wrong bg-wrong-soft",
        className,
      )}
    >
      {children}
      {/* Checked: the mark beside the chip, as on choices (not by colour alone). */}
      {mark === "correct" && <Check className="size-4 shrink-0 text-correct" aria-hidden />}
      {mark === "wrong" && <X className="size-4 shrink-0 text-wrong" aria-hidden />}
    </button>
  );
}

/** An area chips are dropped into (the answer line, the pool they came from). */
export function Zone({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { label } satisfies Named });
  return (
    <fieldset ref={setNodeRef} className={cn(className, isOver && "border-primary bg-primary/10")}>
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  );
}
