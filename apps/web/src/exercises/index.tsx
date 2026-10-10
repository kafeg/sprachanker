// Exercise renderers by type (root rule 2: every type has a renderer). No API calls here.
import { isChecked } from "@sprachanker/engine";
import { type Exercise, type ItemOf, joinParts } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { MultiChoice, SingleChoice } from "./choice.tsx";
import { GapChoice, GapText } from "./gaps.tsx";
import { Match } from "./match.tsx";
import { Order } from "./order.tsx";
import { Respond } from "./respond.tsx";
import { Dictation, SpeechRepeat, SpeechSelfrate } from "./speech.tsx";
import type { Answers, RendererProps } from "./types.ts";

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
    speech_repeat: SpeechRepeat,
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

/** Whether the player checks the exercise (engine's `isChecked`) — and can show it here. */
export const isCheckedHere = (type: Exercise["type"]) => isChecked(type) && type in RENDERERS;

/** The recordings an item is to be heard with before it is answered (09): the exercise's and its own
 *  (`exercise`, `item-<index>`). */
export function toHear(exercise: Exercise, index: number): string[] {
  const media = exercise.items[index]?.media;
  return [
    ...(exercise.media?.audio || exercise.media?.video ? ["exercise"] : []),
    ...(media && ("audio" in media || "video" in media) ? [`item-${index}`] : []),
  ];
}

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
