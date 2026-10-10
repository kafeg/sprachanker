// A planned exercise → one of our types: a practice video as speech_selfrate, a quiz as single or
// multiple choice; anything not available as unknown.
import { draftOrUnknown, type MappedDraft, mediaPath, Unmapped } from "@sprachanker/course-kit";
import {
  type Exercise,
  type ExerciseKey,
  itemKey,
  type LocaleExercise,
  type MediaIndex,
  optionId,
} from "@sprachanker/schema";
import { sdUrl } from "./media.ts";
import type { QuizPlan, SpeechPlan } from "./plan.ts";

interface Normalised {
  exercise: Exercise;
  locale: LocaleExercise;
  unknown: boolean;
}

export function normaliseExercise(
  ex: SpeechPlan | QuizPlan,
  key: ExerciseKey,
  raw: string,
  index: MediaIndex,
): Normalised {
  const locale: LocaleExercise = {
    sourceId: ex.kind === "quiz" ? ex.embed.id : ex.sourceId,
    // No title rather than an empty one ("" would not validate; the player numbers it).
    ...(ex.title ? { title: ex.title } : {}),
    ...(ex.instructionHtml ? { instructionHtml: ex.instructionHtml } : {}),
    items: {},
  };
  // Anything not available stands as `unknown`.
  const { exercise, unmapped } = draftOrUnknown({ key }, raw, () =>
    ex.kind === "speech" ? speech(ex, key, index) : quiz(ex, key, index),
  );
  return { exercise, locale, unknown: unmapped !== undefined };
}

function speech(ex: SpeechPlan, key: ExerciseKey, index: MediaIndex): MappedDraft {
  const video = mediaPath(index, ex.video);
  if (!video) throw new Unmapped("practice video not downloaded");
  return {
    type: "speech_selfrate",
    // The video is the item's stimulus: an item with media and no text is "listen and repeat".
    items: [{ key: itemKey(key, 1), media: { video } }],
  };
}

function quiz(ex: QuizPlan, key: ExerciseKey, index: MediaIndex): MappedDraft {
  if (!ex.questions.length) throw new Unmapped("quiz pages not available");
  const total = ex.questions[0]?.total ?? 0;
  if (ex.questions.length !== total)
    throw new Unmapped(`quiz incomplete: ${ex.questions.length} of ${total} questions`);
  const unanswered = ex.questions.find((q) => !q.options.some((o) => o.correct));
  if (unanswered) throw new Unmapped(`quiz question ${unanswered.index}: no answer marked`);
  const multiple = ex.questions.some(
    (q) => q.multiple || q.options.filter((o) => o.correct).length > 1,
  );
  const items = ex.questions.map((q, i) => {
    const video = mediaPath(index, sdUrl(q.video));
    return {
      key: itemKey(key, i + 1),
      prompt: q.question,
      ...(video ? { media: { video } } : {}),
      options: q.options.map((o, j) => ({ id: optionId(j), text: o.text })),
      answer: {
        optionIds: q.options.flatMap((o, j) => (o.correct ? [optionId(j)] : [])),
      },
    };
  });
  return { type: multiple ? "multi_choice" : "single_choice", items };
}
