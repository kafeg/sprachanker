// What optional features add to the reviewer and the word sheet (09). Both work without any; the
// router provides the AI assistant's (llm/word-example.tsx), so llm/ can be removed with its mount points.
import { createContext, type ReactNode, useContext } from "react";

interface StudySlots {
  /** Under a card's answer and in the word's sheet: more about the word (AI examples). */
  word?(card: { cardId: string }): ReactNode;
}

const Slots = createContext<StudySlots>({});
export const StudySlotsProvider = Slots.Provider;
export const useStudySlots = () => useContext(Slots);
