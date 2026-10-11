// An item the assistant set (04, "AI practice in courses") — an Understanding question, a new item
// going over mistakes — as the item of its closed type: a single choice answered by choosing, the
// others answered and then sent with "Check"; read-only once answered, or without `onAnswer`. Checked
// by the server's engine; shown here with the outcome it gave.
import { answerComplete } from "@sprachanker/engine";
import type { Exercise, Outcome } from "@sprachanker/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemCard } from "@/exercises/item-card.tsx";
import { SourceOrder } from "@/exercises/shared.tsx";
import { Button } from "@/ui/components/button.tsx";

const noMedia = () => "";

export function PracticeItemCard({
  exercise,
  given,
  onAnswer,
  sourceOrder,
}: {
  /** The item as an exercise of its one item. */
  exercise: Exercise;
  given?: { answer: unknown; outcome: Outcome };
  onAnswer?(answer: unknown): void;
  /** Options in the order written (true before false), never shuffled. */
  sourceOrder?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<unknown>();
  const atOnce = exercise.type === "single_choice";
  const change =
    onAnswer && !given
      ? (a: unknown) => {
          setDraft(a);
          if (atOnce) onAnswer(a);
        }
      : undefined;
  const card = (
    <ItemCard
      exercise={exercise}
      locale={null}
      index={0}
      answer={given?.answer ?? draft}
      outcome={given?.outcome}
      url={noMedia}
      onAnswer={change}
    />
  );
  return (
    <div>
      {sourceOrder ? <SourceOrder.Provider value>{card}</SourceOrder.Provider> : card}
      {!atOnce && change && (
        <Button
          variant="outline"
          className="mt-2"
          disabled={!answerComplete(exercise, 0, draft)}
          onClick={() => onAnswer?.(draft)}
        >
          {t("lesson.check")}
        </Button>
      )}
    </div>
  );
}
