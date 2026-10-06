// Exercise renderers by type (root rule 2: every type has a renderer). No API calls here.
import { type Exercise, joinParts } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { MultiChoice, SingleChoice } from "./choice.tsx";
import { GapChoice, GapText } from "./gaps.tsx";
import { Match } from "./match.tsx";
import { Order } from "./order.tsx";
import { Respond } from "./respond.tsx";
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
    respond: Respond,
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

/** Whether the exercise is checked (selfrate and unsupported types are not; respond is checked to show
 *  its model answer, though without a rubric it is not scored). */
export const isScored = (type: Exercise["type"]) => type in RENDERERS && type !== "speech_selfrate";

/**
 * The correct answer as text, under a wrong item, where the renderer does not show it itself (choices,
 * gaps and pairs mark the right option in place).
 */
export function correctAnswer(exercise: Exercise, index: number): string | undefined {
  const item = exercise.items[index];
  switch (exercise.type) {
    case "order": {
      const it = item as ItemOf<"order">;
      return it.parts.some((p) => p.media)
        ? undefined
        : joinParts(
            it.answer.sequence.map((id) => it.parts.find((p) => p.id === id)?.text ?? ""),
            it.join,
          );
    }
    case "dictation":
      return (item as ItemOf<"dictation">).answer.accepted[0];
    default:
      return undefined;
  }
}

const gapsOf = (segments: Array<string | { gap: string }>) =>
  segments.flatMap((s) => (typeof s === "string" ? [] : [s.gap]));

/**
 * Whether an item's answer is complete enough to check: every option, pair, part or gap chosen; text
 * typed. Typed gaps need one gap filled, since a gap may rightly stay empty ("no article").
 */
export function answerComplete(exercise: Exercise, index: number, answer: unknown): boolean {
  if (answer === undefined) return false;
  const item = exercise.items[index];
  switch (exercise.type) {
    case "single_choice":
      return !!(answer as Answers["single_choice"]).optionId;
    case "multi_choice":
      return (answer as Answers["multi_choice"]).optionIds.length > 0;
    case "match":
      return (answer as Answers["match"]).pairs.length === (item as ItemOf<"match">).left.length;
    case "order":
      return (
        (answer as Answers["order"]).sequence.length === (item as ItemOf<"order">).parts.length
      );
    case "gap_choice":
      return gapsOf((item as ItemOf<"gap_choice">).segments).every(
        (g) => !!(answer as Answers["gap_choice"])[g],
      );
    case "gap_text":
      return Object.values(answer as Answers["gap_text"]).some((v) => v.trim() !== "");
    case "dictation":
    case "respond":
      return (answer as { text: string }).text.trim() !== "";
    default:
      return true;
  }
}
