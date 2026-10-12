// Going over mistakes as the lesson's step and the Notebook show it (04, "AI practice in courses";
// 09): a type of mistakes — what went wrong, the learner's wrong parts only (given → right, the words
// around it, an Understanding question's line of its text), the explanation — and its new items as the
// items of their closed types, answered here or read as answered (a type listed only: what to do
// instead); a whole review read again, type by type, with the mistakes left out counted.
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
  const { type } = group;
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">{t(`goingOver.what.${group.what}`)}</h3>
      <div>
        <p className="text-sm font-semibold">{t("goingOver.yours")}</p>
        <ul className="mt-1 space-y-1.5">
          {group.mistakes.map((m) => (
            <li key={`${m.itemKey}:${m.given}:${m.right}`} className="text-sm">
              {m.what !== group.what && (
                <span className="block font-medium">{t(`goingOver.what.${m.what}`)}</span>
              )}
              <span {...inLang(lang)}>
                <s className="text-wrong">{m.given || "—"}</s> →{" "}
                <strong className="text-correct">{m.right}</strong>
              </span>
              {m.context && (
                <span {...inLang(lang)} className="block text-muted-foreground">
                  {m.context}
                </span>
              )}
              {m.line && (
                <span className="block text-muted-foreground">
                  {t("goingOver.inText")} <q {...inLang(lang)}>{m.line}</q>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {type ? (
        <>
          <RichText text={group.explanation} />
          {group.items.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{t("goingOver.try")}</p>
              {group.items.map((item, k) => {
                const n = start + k;
                return (
                  <PracticeItemCard
                    key={n}
                    exercise={mistakeItemExercise(type, item, `${id}-${n}`)}
                    given={given(n)}
                    onAnswer={onAnswer && ((answer) => onAnswer(n, answer))}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`goingOver.listed.${group.what}`)}</p>
      )}
    </section>
  );
}

/** The mistakes a review left out (beyond its types and parts), if any. */
export function MoreMistakes({ review }: { review: MistakesReview }) {
  const { t } = useTranslation();
  return review.more ? (
    <p className="text-sm text-muted-foreground">{t("goingOver.more", { n: review.more })}</p>
  ) : null;
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
      <MoreMistakes review={review} />
    </div>
  );
}
