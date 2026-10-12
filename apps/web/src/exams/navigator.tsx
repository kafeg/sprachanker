// The run's questions as a plan (owner, 2026-10-10: as a lesson's steps), under the titles
// of their Teile (and modules): each with its number and what it asks, where the learner is, what is
// answered — in practice right or wrong — and a tap to go to it. Beside the run on a wide screen, in a
// sheet on a phone (ui/side-layout).
import { useTranslation } from "react-i18next";
import { inLang } from "@/ui/direction.tsx";
import { PlanHeading, PlanNav, PlanRow } from "@/ui/plan-list.tsx";
import { StepDot } from "@/ui/step-dot.tsx";

export type QuestionState = "open" | "answered" | "right" | "wrong";

export interface ListedQuestion {
  index: number;
  state: QuestionState;
  /** What it asks, in a line. */
  line: string;
  /** Its Teil's title ("Hören · Teil 2"): a heading where it changes. */
  group?: string;
}

const DOT = { open: undefined, answered: "done", right: "correct", wrong: "wrong" } as const;

export function QuestionList({
  questions,
  current,
  lang,
  onGo,
}: {
  questions: ListedQuestion[];
  current: number;
  /** The exam's language (the questions' lines). */
  lang: string;
  onGo(index: number): void;
}) {
  const { t } = useTranslation();
  return (
    <PlanNav current={current} label={t("exams.questionsGrid")}>
      {questions.map((q, i) => (
        <div key={q.index}>
          {q.group && q.group !== questions[i - 1]?.group && <PlanHeading>{q.group}</PlanHeading>}
          <PlanRow
            current={q.index === current}
            label={t("exams.goTo", { n: q.index + 1 })}
            onClick={() => onGo(q.index)}
            mark={
              <StepDot
                state={DOT[q.state] ?? (q.index === current ? "current" : undefined)}
                label={q.index + 1}
              />
            }
          >
            <span {...inLang(lang)} className="line-clamp-2 min-w-0 leading-snug">
              {q.line || t("exams.goTo", { n: q.index + 1 })}
            </span>
          </PlanRow>
        </div>
      ))}
    </PlanNav>
  );
}
