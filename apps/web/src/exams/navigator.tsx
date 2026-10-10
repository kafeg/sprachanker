// The run's questions as a grid of numbers (09, Exams; owner's choice B, 2026-10-10), grouped by Teil
// (and module): where the learner is, what is answered — in practice whether right or wrong — and a
// tap to go to any of them.
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";

export interface GridGroup {
  /** "Hören 2", "Teil 1"; none for an exam of one part. */
  label?: string;
  questions: Array<{ index: number; state: "open" | "answered" | "right" | "wrong" }>;
}

export function QuestionGrid({
  groups,
  current,
  onGo,
  className,
}: {
  groups: GridGroup[];
  current: number;
  onGo(index: number): void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("exams.questionsGrid")}
      className={cn("flex flex-wrap gap-x-4 gap-y-2", className)}
    >
      {groups.map((g, gi) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the run's groups, in a fixed order
        <div key={gi} className="flex flex-wrap items-center gap-1">
          {g.label && <span className="mr-1 text-xs text-muted-foreground">{g.label}</span>}
          {g.questions.map((q) => (
            <button
              key={q.index}
              type="button"
              onClick={() => onGo(q.index)}
              aria-current={q.index === current ? "step" : undefined}
              aria-label={t("exams.goTo", { n: q.index + 1 })}
              className={cn(
                "grid size-8 place-items-center rounded-md border text-xs tabular-nums transition pointer-coarse:size-10",
                q.state === "answered" && "border-primary bg-primary/25",
                q.state === "right" && "border-correct bg-correct-soft text-correct",
                q.state === "wrong" && "border-wrong bg-wrong-soft text-wrong",
                q.state === "open" && "bg-card hover:bg-accent",
                q.index === current &&
                  "ring-2 ring-foreground ring-offset-1 ring-offset-background",
              )}
            >
              {q.index + 1}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
