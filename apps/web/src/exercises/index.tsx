// Exercise renderers by type (root rule 2: every type has a renderer). No API calls here.
import type { Exercise } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { MultiChoice, SingleChoice } from "./choice.tsx";
import { GapChoice, GapText } from "./gaps.tsx";
import { Match } from "./match.tsx";
import { joinParts, Order } from "./order.tsx";
import { Dictation, SpeechSelfrate } from "./speech.tsx";
import type { Answers, ItemOf, RendererProps } from "./types.ts";

export type { Answers, RendererProps } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: each renderer gets the props of its own type
const RENDERERS: Partial<Record<Exercise["type"], (props: RendererProps<any>) => React.ReactNode>> =
  {
    single_choice: SingleChoice,
    multi_choice: MultiChoice,
    match: Match,
    order: Order,
    gap_choice: GapChoice,
    gap_text: GapText,
    dictation: Dictation,
    speech_selfrate: SpeechSelfrate,
  };

export function ExerciseItem({
  type,
  ...props
}: { type: Exercise["type"] } & RendererProps<keyof Answers>) {
  const { t } = useTranslation();
  const Renderer = RENDERERS[type];
  return Renderer ? (
    <Renderer {...props} />
  ) : (
    <p className="text-muted-foreground">{t("ex.unknown")}</p>
  );
}

/** Whether checking makes sense for this type (selfrate and unsupported types are not scored). */
export const isScored = (type: Exercise["type"]) => type in RENDERERS && type !== "speech_selfrate";

/** The correct answer as text, for the feedback line. */
export function correctAnswer(exercise: Exercise, index: number): string | undefined {
  const item = exercise.items[index];
  switch (exercise.type) {
    case "single_choice":
    case "multi_choice": {
      const it = item as ItemOf<"single_choice">;
      const texts = it.answer.optionIds.map((id) => it.options.find((o) => o.id === id)?.text);
      if (!texts.every(Boolean)) return undefined;
      // Whole sentences ("Yara ist Nicos Tante.") are not joined with commas.
      return texts.join(texts.some((t) => /[.!?]$/.test(t ?? "")) ? " · " : ", ");
    }
    case "order": {
      const it = item as ItemOf<"order">;
      return it.parts.some((p) => p.media)
        ? undefined
        : joinParts(it.parts, it.answer.sequence, it.join);
    }
    case "dictation":
      return (item as ItemOf<"dictation">).answer.accepted[0];
    default:
      return undefined;
  }
}
