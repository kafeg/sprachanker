// Going over mistakes as the lesson's step and the Notebook show it (04, "AI practice in courses";
// 09): a type of mistakes — what went wrong, the learner's wrong parts only (given → right, the words
// around it), the explanation — and its new items as the items of their closed types, answered here
// or read as answered; a whole review read again, type by type.
import { mistakeItemExercise, reviewItems } from "@sprachanker/engine";
import type {
  MistakeGroup,
  MistakesReview,
  Outcome,
  PracticeAnsweredPayload,
} from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { inLang } from "@/ui/direction.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import { PracticeItemCard } from "./practice-item.tsx";

/** An answer kept on a review's new item (its number across the review's groups). */
type Given = Pick<PracticeAnsweredPayload, "question" | "answer" | "outcome">;

/** The number of a group's first item across the review. */
export const groupStart = (review: MistakesReview, group: number) =>
  review.groups.slice(0, group).reduce((n, g) => n + g.items.length, 0);

/** How many of a review's new items were answered right, of how many. */
export const reviewScore = (review: MistakesReview, answers: Given[]) => ({
  right: answers.filter((a) => a.outcome.result === "correct").length,
  total: reviewItems(review).length,
});

/** One type of mistakes: its name, the wrong parts, the explanation, the new items. `start`: the
 *  number of its first item across the review; `id`: the review's. */
export function ReviewGroup({
  group,
  start,
  id,
  answers,
  lang,
  onAnswer,
}: {
  group: MistakeGroup;
  start: number;
  id: string;
  answers: Given[];
  lang: string;
  onAnswer?(question: number, answer: unknown): void;
}) {
  const { t } = useTranslation();
  const given = (n: number): { answer: unknown; outcome: Outcome } | undefined =>
    answers.find((a) => a.question === n);
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">{t(`goingOver.what.${group.what}`)}</h3>
      <div>
        <p className="text-sm font-semibold">{t("goingOver.yours")}</p>
        <ul className="mt-1 space-y-1.5">
          {group.mistakes.map((m) => (
            <li key={`${m.itemKey}:${m.given}:${m.right}`} className="text-sm">
              <span {...inLang(lang)}>
                <s className="text-wrong">{m.given || "—"}</s> →{" "}
                <strong className="text-correct">{m.right}</strong>
              </span>
              {m.context && (
                <span {...inLang(lang)} className="block text-muted-foreground">
                  {m.context}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <RichText text={group.explanation} />
      <div className="space-y-3">
        <p className="text-sm font-semibold">{t("goingOver.try")}</p>
        {group.items.map((item, k) => {
          const n = start + k;
          return (
            <PracticeItemCard
              key={n}
              exercise={mistakeItemExercise(group.type, item, `${id}-${n}`)}
              given={given(n)}
              onAnswer={onAnswer && ((answer) => onAnswer(n, answer))}
            />
          );
        })}
      </div>
    </section>
  );
}

/** A review read again: every type of it, as answered. */
export function ReviewedMistakes({
  id,
  review,
  answers,
  lang,
}: {
  id: string;
  review: MistakesReview;
  answers: Given[];
  lang: string;
}) {
  return (
    <div className="space-y-6">
      {review.groups.map((group, g) => (
        <ReviewGroup
          // biome-ignore lint/suspicious/noArrayIndexKey: a review's groups, fixed order
          key={g}
          group={group}
          start={groupStart(review, g)}
          id={id}
          answers={answers}
          lang={lang}
        />
      ))}
    </div>
  );
}
