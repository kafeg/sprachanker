// dictation, speech_repeat, speech_selfrate: listen and write, listen and say.
import { z } from "zod";
import { BlobRef } from "../common.ts";
import { exerciseOf, ItemBase } from "./base.ts";

/** A recorded spoken answer: profile recording id and the recogniser's transcript (08). */
export const SpokenAnswer = z.object({ recording: z.string().min(1), transcript: z.string() });

export const DictationItem = ItemBase.extend({
  media: z.object({ audio: BlobRef }),
  answer: z.object({ accepted: z.array(z.string().min(1)).min(1) }),
});
export const DictationAnswer = z.object({ text: z.string() });
export const DictationExercise = exerciseOf("dictation", DictationItem);

export const SpeechRepeatItem = ItemBase.extend({ text: z.string().min(1) });
export const SpeechRepeatAnswer = z.object({ speech: SpokenAnswer });
export const SpeechRepeatExercise = exerciseOf("speech_repeat", SpeechRepeatItem);

/** Source form of self-rated speaking; compose upgrades it (04). */
export const SpeechSelfrateItem = ItemBase.extend({ text: z.string().min(1).optional() });
export const SpeechSelfrateAnswer = z.object({ rating: z.enum(["good", "fair", "poor"]) });
export const SpeechSelfrateExercise = exerciseOf("speech_selfrate", SpeechSelfrateItem);
