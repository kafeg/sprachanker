// What optional features add to the reviewer, the word sheet and the decks (09). All work without any;
// the router provides the AI assistant's (llm/word-examples.tsx), so llm/ can be removed with its mount
// points.
import { createContext, type ReactNode, useContext } from "react";

interface StudySlots {
  /** Under a card's answer and in the word's sheet: more about the word (its deck's AI examples). */
  word?(card: { cardId: string }): ReactNode;
  /** In a card's corner (with the answer) and the word's sheet: the way to its deck in Decks for what
   *  the deck has yet to make for it — its audio (`audio`: the word has none), its examples. */
  corner?(card: { cardId: string; scope: string; audio: boolean }): ReactNode;
  /** Under a deck in Review → Decks: what is made for its words (examples) — its actions under a deck
   *  to take, how it stands under a deck taken. */
  deck?(deck: DeckSlot): ReactNode;
}

/** A deck as Review → Decks shows what is made for its words: a course's or an imported deck
 *  (`scope`) in a language pair (`edition`), named (`title`, for what is asked first). */
export interface DeckSlot {
  scope: string;
  edition: string;
  title?: string;
  /** Only how it stands, in a line (a deck taken). */
  status?: boolean;
  className?: string;
}

const Slots = createContext<StudySlots>({});
export const StudySlotsProvider = Slots.Provider;
export const useStudySlots = () => useContext(Slots);
