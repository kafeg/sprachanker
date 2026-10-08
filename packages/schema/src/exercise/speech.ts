// dictation, speech_repeat, speech_selfrate: listen and write, listen and say.
import { z } from "zod";
import { MediaPath } from "../common.ts";
import { exerciseOf, ItemBase } from "./base.ts";

/** A recorded spoken answer: profile recording id and the recogniser's transcript (08). */
export const SpokenAnswer = z.object({ recording: z.string().min(1), transcript: z.string() });

export const DictationItem = ItemBase.extend({
  media: z.object({ audio: MediaPath }),
  answer: z.object({ accepted: z.array(z.string().min(1)).min(1) }),
});
export const DictationAnswer = z.object({ text: z.string() });
export const DictationExercise = exerciseOf("dictation", DictationItem);

export const SpeechRepeatItem = ItemBase.extend({ text: z.string().min(1) });
export const SpeechRepeatAnswer = z.object({ speech: SpokenAnswer });
export const SpeechRepeatExercise = exerciseOf("speech_repeat", SpeechRepeatItem);

/** Speaking without a check: listen, then record oneself (the courses' "say it" exercises; compose
 *  upgrades one with a reference text, 04). */
export const SpeechSelfrateItem = ItemBase.extend({ text: z.string().min(1).optional() });
/** Answered once the learner recorded themselves: the profile recording when they are kept (none when
 *  the learner keeps no recordings). `rating`: the self-rating of answers given before 2026-10-08. */
export const SpeechSelfrateAnswer = z.object({
  recording: z.string().min(1).optional(),
  rating: z.enum(["good", "fair", "poor"]).optional(),
});

/** The profile recording an answer refers to, if any (a spoken answer or a recorded self-check). */
export function recordingOf(answer: unknown): string | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const a = answer as { recording?: unknown; speech?: { recording?: unknown } };
  const id = a.recording ?? a.speech?.recording;
  return typeof id === "string" ? id : undefined;
}
export const SpeechSelfrateExercise = exerciseOf("speech_selfrate", SpeechSelfrateItem);
export type DictationAnswer = z.infer<typeof DictationAnswer>;
export type SpeechRepeatAnswer = z.infer<typeof SpeechRepeatAnswer>;
export type SpeechSelfrateAnswer = z.infer<typeof SpeechSelfrateAnswer>;
