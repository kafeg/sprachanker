// An exercise's mark (09): in the lesson's plan and summary, and a pass in the Notebook.
import type { ExerciseMark } from "@sprachanker/engine";
import { Check, SkipForward, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./utils.ts";

/** An exercise's mark in the plan and the summary: right (green ✓), partly right (✓ in the
 *  mistakes' colour, unfilled), with mistakes (red ✕), answered without a score (grey ✓), skipped
 *  (dashed ⏭), the current one (yellow ring), else its number. */
export function StepDot({
  state,
  label,
}: {
  /** An exercise's mark (the engine's `exerciseMark`: the same everywhere), a step besides
   *  exercises done ("read"), or the current exercise. */
  state?: ExerciseMark | "read" | "current";
  label: React.ReactNode;
}) {
  const { t } = useTranslation();
  const worked = state && state !== "current";
  return (
    <span
      title={worked ? t(`lesson.state.${state}`) : undefined}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
        state === "correct" && "border-correct bg-correct text-white",
        state === "wrong" && "border-wrong bg-wrong text-white",
        state === "partial" && "border-wrong bg-wrong-soft text-wrong",
        state === "done" && "border-muted-foreground/60 bg-muted text-muted-foreground",
        state === "skipped" && "border-dashed border-muted-foreground/60 text-muted-foreground",
        state === "read" && "border-correct text-correct",
        state === "current" && "border-primary",
      )}
    >
      {state === "correct" || state === "partial" || state === "done" || state === "read" ? (
        <Check className="size-3.5" />
      ) : state === "wrong" ? (
        <X className="size-3.5" />
      ) : state === "skipped" ? (
        <SkipForward className="size-3" />
      ) : (
        label
      )}
      {worked && <span className="sr-only">{t(`lesson.state.${state}`)}</span>}
    </span>
  );
}
