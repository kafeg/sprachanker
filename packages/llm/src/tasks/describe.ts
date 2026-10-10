// One exercise item as plain text for prompts: the task, the correct answer and the learner's answer.
import {
  correctOptions,
  DictationAnswer,
  type Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  type ItemOf,
  joinParts,
  type LocaleExercise,
  MatchAnswer,
  MultiChoiceAnswer,
  type Option,
  OrderAnswer,
  SingleChoiceAnswer,
  SpeechSelfrateAnswer,
} from "@sprachanker/schema";
import type { z } from "zod";
import { clip, htmlToText } from "../text.ts";

export interface ItemDescription {
  task: string;
  correct: string;
  /** Undefined when the learner gave no answer. */
  learner?: string;
}

type Segment = string | { gap: string };

/** What applies to every item of an exercise: its instruction and text. */
export function exerciseHeader(exercise: Exercise, locale: LocaleExercise | undefined): string[] {
  return [
    locale?.instructionHtml && `Instruction: ${htmlToText(locale.instructionHtml)}`,
    exercise.text && `Text: ${exercise.text}`,
    locale?.textHtml && `Text (learner's language): ${htmlToText(locale.textHtml)}`,
  ].filter((l): l is string => !!l);
}

/** One item; `header: false` leaves out the exercise's instruction and text (given once instead). */
export function describeItem(
  exercise: Exercise,
  locale: LocaleExercise | undefined,
  index: number,
  answer: unknown,
  { header = true }: { header?: boolean } = {},
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
    ...(header ? exerciseHeader(exercise, locale) : []),
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
        task: task([`Options: ${quoted(it.options.map(label))}`]),
        correct: quoted(text(it.answer.optionIds)),
        learner: given === undefined ? undefined : quoted(text([given].flat())),
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
      const joined = (ids: string[]) =>
        joinParts(
          ids.map((id) => it.parts.find((p) => p.id === id)).map((p) => p && label(p)),
          it.join,
        );
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
        correct: fill(it.segments, (gap) =>
          correctOptions(it.answer[gap])
            .map((id) => option(gap, id))
            .join(" | "),
        ),
        learner: given && fill(it.segments, (gap) => option(gap, given[gap])),
      };
    }
    case "gap_text": {
      const it = item as ItemOf<"gap_text">;
      const given = parse(GapTextAnswer);
      return {
        task: task([`Fill the gaps: ${fill(it.segments, () => "___")}`]),
        correct: fill(it.segments, (gap) =>
          it.answer[gap]?.accepted.map((a) => a || "(nothing)").join(" | "),
        ),
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
    case "speech_selfrate": {
      const it = item as ItemOf<"speech_selfrate">;
      const heard = parse(SpeechSelfrateAnswer)?.transcript;
      return it.text
        ? { task: task([`Say: ${it.text}`]), correct: it.text, learner: heard }
        : { task: task(["Answer aloud."]), correct: "(any fitting answer)", learner: heard };
    }
    default:
      return { task: task([]), correct: "(not available)" };
  }
}

/** Option texts may be whole sentences with their own punctuation: quote each. */
const quoted = (texts: string[]) => texts.map((t) => `"${t}"`).join(", ");

function fill(segments: Segment[], value: (gap: string) => string | undefined): string {
  return segments
    .map((s) => (typeof s === "string" ? s : `[${value(s.gap) ?? "___"}]`))
    .join("")
    .trim();
}

/** A mistake the learner made: an item, the answer given, and whether a later attempt was right. */
export interface TutorMistake {
  /** Lesson title (for mistakes in other lessons). */
  lesson?: string;
  exercise: Exercise;
  locale?: LocaleExercise;
  index: number;
  answer: unknown;
  /** An answer said aloud: the model's correction of what was heard. */
  corrected?: string;
  /** A later attempt was correct. */
  fixed: boolean;
}

/** A mistake in two short lines: where (lesson, exercise, item) and the item's task, then the correct
 *  and the learner's answer. */
export function mistakeLine(m: TutorMistake): string {
  const d = describeItem(m.exercise, m.locale, m.index, m.answer, { header: false });
  const where = [m.lesson, m.locale?.title, `item ${m.index + 1}`].filter(Boolean);
  return [
    `- [${where.join(" · ")}] ${clip(d.task.replaceAll("\n", " · "), 200)}`.trimEnd(),
    `  correct: ${m.corrected ?? d.correct}; learner: ${d.learner ?? "(no answer)"}${m.fixed ? " (fixed later)" : ""}`,
  ].join("\n");
}
