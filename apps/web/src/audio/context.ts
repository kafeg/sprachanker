// What the app gives recording screens (08): where a take is kept and played from, and recognition
// (on or not, transcribing, warming). The router provides it from the profile's settings and the API; the exercise renderers read it, so they call no API themselves.
import { createContext, useContext } from "react";
import type { Take } from "./recorder.ts";

export interface SpeechHost {
  /** Keeps a take; its recording id. */
  save(take: Take): Promise<string>;
  /** Where a kept recording plays from. */
  src(id: string): string;
  /** Speech recognition is on and ready (the engine and a model, 08). */
  recognition: boolean;
  /** What was said in a take, in a language given. */
  transcribe(take: Take, lang: string): Promise<string>;
  /** Starts the recogniser ahead of a recording (loading its model takes seconds). */
  warm(): void;
}

const Speech = createContext<SpeechHost | undefined>(undefined);
export const SpeechProvider = Speech.Provider;
/** The app's speech host; undefined outside the app (a renderer then records nothing to keep). */
export const useSpeechHost = () => useContext(Speech);
