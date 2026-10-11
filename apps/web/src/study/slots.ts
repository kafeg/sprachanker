// What optional features add to the reviewer, the word sheet and the decks (09). All work without any;
// the router provides the AI assistant's (llm/word-examples.tsx), so llm/ can be removed with its mount
// points.
import { createContext, type ReactNode, useContext } from "react";
import type { CardExample } from "./examples.tsx";

interface StudySlots {
  /** In the word's sheet: more about the word (the AI's examples of `deck`, the deck whose entry of
   *  the word is shown). */
  word?(card: { cardId: string; deck: string }): ReactNode;
  /** With a card's answer: the AI's examples of `deck` handed to the card (`onItems`), shown one at a
   *  time after its own; renders nothing itself. */
  examples?(card: { cardId: string; deck: string; onItems(items: CardExample[]): void }): ReactNode;
  /** In a card's corner (with the answer) and the word's sheet: the way to its deck in Decks for what
   *  the deck has yet to make for it — its audio (`audio`: the word has none), its examples (`compact`:
   *  an icon on a phone, as the card's corner has it). */
  corner?(card: { cardId: string; scope: string; audio: boolean; compact?: boolean }): ReactNode;
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
