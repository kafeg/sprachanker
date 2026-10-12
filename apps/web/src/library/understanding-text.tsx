// An Understanding text as the lesson's step and the Notebook show it (
// 09): its lines — a dialogue's with their speakers —, the glossed words marked with their
// translations and listed under it; its questions as the items of their closed types, in the order
// written (Richtig before Falsch), answered here or read as answered.
import { understandingExercise } from "@sprachanker/engine";
import type {
  Outcome,
  PracticeAnsweredPayload,
  UnderstandingQuestion,
  UnderstandingText,
} from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { GapDigits } from "@/exercises/gaps.tsx";
import { inLang } from "@/ui/direction.tsx";
import { glossed } from "./glossed.ts";
import { PracticeItemCard } from "./practice-item.tsx";

/** An answer kept on a text's question. */
type Given = Pick<PracticeAnsweredPayload, "question" | "answer" | "outcome">;

/** A run of a line: a glossed word marked, its translation on pointing at it. */
function Run({ text, gloss }: { text: string; gloss?: string }) {
  return gloss ? (
    <mark title={gloss} className="rounded bg-primary/15 px-0.5 text-inherit">
      {text}
    </mark>
  ) : (
    text
  );
}

/** The text's lines, its glossed words marked, then the new words with their translations. */
export function UnderstandingLines({
  text,
  lang,
}: {
  text: Pick<UnderstandingText, "lines" | "glossary">;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div {...inLang(lang)} className="space-y-1.5 text-lg leading-relaxed">
        {text.lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a text's lines, fixed order
          <p key={i}>
            {line.speaker && <span className="font-semibold">{line.speaker}: </span>}
            {glossed(line.text, text.glossary).map((run, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: runs of one line, fixed order
              <Run key={k} text={run.text} gloss={run.gloss} />
            ))}
          </p>
        ))}
      </div>
      {text.glossary.length > 0 && (
        <div>
          <p className="text-sm font-semibold">{t("understanding.newWords")}</p>
          <ul className="text-sm">
            {text.glossary.map((g) => (
              <li key={g.word}>
                <span {...inLang(lang)} className="font-medium">
                  {g.word}
                </span>{" "}
                — {g.translation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A question as the item of its kind (a choice answered by choosing, an answer typed by "Check"),
 *  its options in the order written; read-only once answered, or without `onAnswer`; answered with
 *  the others and checked by the page's Check with `onDraft`. An answer typed is a number, a price or
 *  a time: its field says so, without the language's letters under it. `id`: the question's own (its
 *  text's and its number). */
export function UnderstandingQuestionCard({
  question,
  id,
  given,
  onAnswer,
  draft,
  onDraft,
}: {
  question: UnderstandingQuestion;
  id: string;
  given?: { answer: unknown; outcome: Outcome };
  onAnswer?(answer: unknown): void;
  draft?: unknown;
  onDraft?(answer: unknown): void;
}) {
  const { t } = useTranslation();
  return (
    <GapDigits.Provider value={question.options ? undefined : t("understanding.digits")}>
      <PracticeItemCard
        exercise={understandingExercise(question, id)}
        given={given}
        onAnswer={onAnswer}
        draft={draft}
        onDraft={onDraft}
        sourceOrder
      />
    </GapDigits.Provider>
  );
}

/** How many of a text's questions were answered right, of how many. */
export const understandingScore = (text: UnderstandingText, answers: Given[]) => ({
  right: answers.filter((a) => a.outcome.result === "correct").length,
  total: text.questions.length,
});

/** A text read again: its lines, then each question as it was answered. */
export function UnderstoodText({
  id,
  text,
  answers,
  lang,
}: {
  id: string;
  text: UnderstandingText;
  answers: Given[];
  lang: string;
}) {
  return (
    <div className="space-y-3">
      <UnderstandingLines text={text} lang={lang} />
      {text.questions.map((q, n) => (
        <UnderstandingQuestionCard
          // biome-ignore lint/suspicious/noArrayIndexKey: a text's questions, fixed order
          key={n}
          question={q}
          id={`${id}-${n}`}
          given={answers.find((a) => a.question === n)}
        />
      ))}
    </div>
  );
}
