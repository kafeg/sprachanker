// What optional features add to the reviewer, the word sheet and the decks (09). All work without any;
// the router provides the AI assistant's (llm/word-examples.tsx), so llm/ can be removed with its mount
// points.
import { createContext, type ReactNode, useContext } from "react";

interface StudySlots {
  /** Under a card's answer and in the word's sheet: more about the word (its deck's AI examples). */
  word?(card: { cardId: string }): ReactNode;
  /** Under a course's or an imported deck in Review → Decks: what is made for its words (examples). */
  deck?(deck: { scope: string; className?: string }): ReactNode;
}

const Slots = createContext<StudySlots>({});
export const StudySlotsProvider = Slots.Provider;
export const useStudySlots = () => useContext(Slots);
