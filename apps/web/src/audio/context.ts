// What the app gives recording screens (08): whether recordings are kept, where one is saved and
// played from, how the phrase to repeat is shown. The router provides it from the profile's settings
// and the API; the exercise renderers read it, so they call no API themselves.
import { createContext, useContext } from "react";
import type { Take } from "./recorder.ts";

export interface SpeechHost {
  /** Recordings are kept in the profile (Settings → Speech). */
  keepRecordings: boolean;
  /** The phrase to repeat: hidden until the first attempt, or shown at once. */
  showText: "after" | "always";
  /** Keeps a take; its recording id. */
  save(take: Take): Promise<string>;
  /** Where a kept recording plays from. */
  src(id: string): string;
}

const Speech = createContext<SpeechHost | undefined>(undefined);
export const SpeechProvider = Speech.Provider;
/** The app's speech host; undefined outside the app (a renderer then records nothing to keep). */
export const useSpeechHost = () => useContext(Speech);
