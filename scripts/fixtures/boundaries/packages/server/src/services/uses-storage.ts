// Violation: a service reaches a storage adapter itself; allowed: its type.
import { type DeckFiles, deckFiles } from "../storage/decks.ts";

export const used = deckFiles;
export type Used = DeckFiles;
