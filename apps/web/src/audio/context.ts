// What the app gives recording screens (08): where a take is kept and played from, and recognition
// (on or not, transcribing, warming). The router provides it from the profile's settings and the API; the exercise renderers read it, so they call no API themselves.
import { createContext, useContext } from "react";
import type { Take } from "./recorder.ts";

export interface SpeechHost {
  /** Keeps a take; its recording id. */
  save(take: Take): Promise<string>;
  /** Where a kept recording plays from. */
  src(id: string): string;
  /** A recording an answer names is still kept (not deleted with all of them); unknown: kept. */
  kept?(id: string): boolean;
  /** Speech recognition is on and ready (the engine and a model, 08). */
  recognition: boolean;
  /** What was said in a take, in a language given; empty when nothing was heard (silence, noise,
   *  what the recogniser makes of them). `expected`: the lines the learner was to say, if any. */
  transcribe(take: Take, lang: string, expected?: readonly string[]): Promise<string>;
  /** Starts the recogniser ahead of a recording (loading its model takes seconds). */
  warm(): void;
  /** Forgets a kept take nothing was heard in (kept while it was heard); one an answer holds stays. */
  forget?(id: string): void;
  /** How long a take waits to be heard before it counts without what was heard (default 15 s). */
  hearingMs?: number;
}

const Speech = createContext<SpeechHost | undefined>(undefined);
export const SpeechProvider = Speech.Provider;
/** The app's speech host; undefined outside the app (a renderer then records nothing to keep). */
export const useSpeechHost = () => useContext(Speech);
