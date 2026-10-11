// dictation, speech_repeat, speech_selfrate: listen and write, listen and say.
import { z } from "zod";
import { MediaPath } from "../common.ts";
import { exerciseOf, ItemBase } from "./base.ts";

/** A spoken answer: what the recogniser heard (08), and the profile recording when recordings are
 *  kept. */
export const SpokenAnswer = z.strictObject({
  recording: z.string().min(1).optional(),
  /** As long as a self-rated answer's: a take is at most a few minutes. Checked when an answer is
   *  checked (stored payloads keep `answer` as it was). */
  transcript: z.string().max(2000),
});

const DictationItem = ItemBase.extend({
  media: z.strictObject({ audio: MediaPath }),
  answer: z.strictObject({ accepted: z.array(z.string().min(1)).min(1) }),
});
export const DictationAnswer = z.strictObject({ text: z.string() });
export const DictationExercise = exerciseOf("dictation", DictationItem);

const SpeechRepeatItem = ItemBase.extend({ text: z.string().min(1) });
export const SpeechRepeatAnswer = z.strictObject({ speech: SpokenAnswer });
export const SpeechRepeatExercise = exerciseOf("speech_repeat", SpeechRepeatItem);

/** Speaking oneself (the courses' "say it" exercises): listen, then record oneself; recorded is done.
 *  Its `prompt` is what the item asks (a question, a situation, words to use), `text` a phrase to
 *  repeat after its recording, `reference` the source's answer to say. What was heard gets a word
 *  diff against the line to say (engine `linesToSay`); without one, the AI checks it (08). Its
 *  `answerAudio` is played after the learner's first try. */
const SpeechSelfrateItem = ItemBase.extend({
  text: z.string().min(1).optional(),
  /** The source's answer, written (as respond's model answers): a line to say ("Ja, ich war schon in
   *  Berlin. / Nein, …": alternatives split by " / ") or its frame ("Ich trinke …"). */
  reference: z.array(z.string().min(1)).min(1).optional(),
});
/** Answered once the learner recorded themselves: the profile recording when they are kept (none when
 *  the learner keeps no recordings), and what the recogniser heard when it is on (08). `rating`: the
 *  self-rating of answers given before 2026-10-08. */
export const SpeechSelfrateAnswer = z.strictObject({
  recording: z.string().min(1).optional(),
  transcript: z.string().max(2000).optional(),
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
