// A planned exercise → one of our types: a practice video as speech_selfrate, a quiz as single or
// multiple choice; anything not available as unknown.
import {
  type ExerciseDraft,
  type MediaIndex,
  mediaPath,
  withFingerprint,
} from "@sprachanker/course-kit";
import {
  type Exercise,
  type ExerciseKey,
  itemKey,
  type LocaleExercise,
  optionId,
} from "@sprachanker/schema";
import { sdUrl } from "./media.ts";
import type { QuizPlan, SpeechPlan } from "./plan.ts";

interface Normalised {
  exercise: Exercise;
  locale: LocaleExercise;
  unknown: boolean;
}

function unknownExercise(
  key: ExerciseKey,
  raw: string,
  reason: string,
  locale: LocaleExercise,
): Normalised {
  const items = [{ key: itemKey(key, 1), raw, reason }];
  return {
    exercise: withFingerprint({ key, type: "unknown", newWords: [], ruleIds: [], items }),
    locale,
    unknown: true,
  };
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
  if (ex.kind === "speech") {
    const video = mediaPath(index, ex.video);
    if (!video) return unknownExercise(key, raw, "practice video not downloaded", locale);
    return {
      exercise: withFingerprint({
        key,
        type: "speech_selfrate",
        newWords: [],
        ruleIds: [],
        // The video is the item's stimulus: an item with media and no text is "listen and repeat".
        items: [{ key: itemKey(key, 1), media: { video } }],
      }),
      locale,
      unknown: false,
    };
  }
  if (!ex.questions.length) return unknownExercise(key, raw, "quiz pages not available", locale);
  const total = ex.questions[0]?.total ?? 0;
  if (ex.questions.length !== total) {
    return unknownExercise(
      key,
      raw,
      `quiz incomplete: ${ex.questions.length} of ${total} questions`,
      locale,
    );
  }
  const unanswered = ex.questions.find((q) => !q.options.some((o) => o.correct));
  if (unanswered) {
    return unknownExercise(key, raw, `quiz question ${unanswered.index}: no answer marked`, locale);
  }
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
  const draft = {
    key,
    type: multiple ? "multi_choice" : "single_choice",
    newWords: [],
    ruleIds: [],
    items,
  } as ExerciseDraft;
  return { exercise: withFingerprint(draft), locale, unknown: false };
}
