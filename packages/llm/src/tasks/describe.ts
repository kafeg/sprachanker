// One exercise item as plain text for prompts: the task, the correct answer and the learner's answer.
import {
  DictationAnswer,
  type Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  type LocaleExercise,
  MatchAnswer,
  MultiChoiceAnswer,
  type Option,
  OrderAnswer,
  SingleChoiceAnswer,
} from "@sprachanker/schema";
import type { z } from "zod";
import { htmlToText } from "../text.ts";

export interface ItemDescription {
  task: string;
  correct: string;
  /** Undefined when the learner gave no answer. */
  learner?: string;
}

type ItemOf<T extends Exercise["type"]> = Extract<Exercise, { type: T }>["items"][number];
type Segment = string | { gap: string };

export function describeItem(
  exercise: Exercise,
  locale: LocaleExercise | undefined,
  index: number,
  answer: unknown,
): ItemDescription {
  const item = exercise.items[index];
  if (!item) throw new Error(`no item ${index} in ${exercise.key}`);
  const loc = locale?.items[`#${index + 1}`];
  const label = (o: Option) =>
    o.text ?? loc?.options?.[o.id] ?? loc?.alt?.[o.id] ?? `[picture ${o.id}]`;
  const parse = <S extends z.ZodType>(schema: S): z.infer<S> | undefined => {
    const result = schema.safeParse(answer);
    return result.success ? result.data : undefined;
  };

  const lines = [
    locale?.instructionHtml && `Instruction: ${htmlToText(locale.instructionHtml)}`,
    exercise.text && `Text: ${exercise.text}`,
    locale?.textHtml && `Text (learner's language): ${htmlToText(locale.textHtml)}`,
    item.prompt && `Prompt: ${item.prompt}`,
    loc?.prompt && `Prompt (learner's language): ${loc.prompt}`,
    loc?.hintHtml && `Hint: ${htmlToText(loc.hintHtml)}`,
  ];
  const task = (extra: Array<string | undefined>) =>
    [...lines, ...extra].filter(Boolean).join("\n");

  switch (exercise.type) {
    case "single_choice":
    case "multi_choice": {
      const it = item as ItemOf<"single_choice">;
      const text = (ids: string[]) =>
        ids.map((id) => it.options.find((o) => o.id === id)).map((o) => (o ? label(o) : "?"));
      const given =
        exercise.type === "single_choice"
          ? parse(SingleChoiceAnswer)?.optionId
          : parse(MultiChoiceAnswer)?.optionIds;
      return {
        task: task([`Options: ${it.options.map(label).join(" / ")}`]),
        correct: text(it.answer.optionIds).join(", "),
        learner: given === undefined ? undefined : text([given].flat()).join(", "),
      };
    }
    case "match": {
      const it = item as ItemOf<"match">;
      const pairs = (list: Array<[string, string]>) =>
        list
          .map(([l, r]) => {
            const left = it.left.find((o) => o.id === l);
            const right = it.right.find((o) => o.id === r);
            return `${left ? label(left) : "?"} — ${right ? label(right) : "?"}`;
          })
          .join("; ");
      const given = parse(MatchAnswer);
      return {
        task: task(["Match the left entries with the right ones."]),
        correct: pairs(it.answer.pairs),
        learner: given && pairs(given.pairs),
      };
    }
    case "order": {
      const it = item as ItemOf<"order">;
      const joined = (ids: string[]) => {
        const parts = ids.map((id) => it.parts.find((p) => p.id === id)).map((p) => p && label(p));
        return it.join === "none" ? parts.join("") : parts.join(" ").replace(/ ([.,!?;:])/g, "$1");
      };
      const given = parse(OrderAnswer);
      return {
        task: task([`Put these parts in the right order: ${it.parts.map(label).join(" / ")}`]),
        correct: joined(it.answer.sequence),
        learner: given && joined(given.sequence),
      };
    }
    case "gap_choice": {
      const it = item as ItemOf<"gap_choice">;
      const option = (gap: string, id: string | undefined) => {
        const o = it.gaps[gap]?.options.find((x) => x.id === id);
        return o && label(o);
      };
      const given = parse(GapChoiceAnswer);
      return {
        task: task([
          `Fill the gaps: ${fill(it.segments, () => "___")}`,
          `Choices: ${Object.entries(it.gaps)
            .map(([gap, g]) => `${gap}: ${g.options.map(label).join(" / ")}`)
            .join("; ")}`,
        ]),
        correct: fill(it.segments, (gap) => option(gap, it.answer[gap])),
        learner: given && fill(it.segments, (gap) => option(gap, given[gap])),
      };
    }
    case "gap_text": {
      const it = item as ItemOf<"gap_text">;
      const given = parse(GapTextAnswer);
      return {
        task: task([`Fill the gaps: ${fill(it.segments, () => "___")}`]),
        correct: fill(it.segments, (gap) => it.answer[gap]?.accepted.join(" | ")),
        learner: given && fill(it.segments, (gap) => given[gap]?.trim() || undefined),
      };
    }
    case "dictation": {
      const it = item as ItemOf<"dictation">;
      return {
        task: task(["Listen to the audio and write what you hear."]),
        correct: it.answer.accepted.join(" | "),
        learner: parse(DictationAnswer)?.text,
      };
    }
    default:
      return { task: task([]), correct: "(not available)" };
  }
}

function fill(segments: Segment[], value: (gap: string) => string | undefined): string {
  return segments
    .map((s) => (typeof s === "string" ? s : `[${value(s.gap) ?? "___"}]`))
    .join("")
    .trim();
}
