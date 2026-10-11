// An imported deck (04, "Decks"; 05, "Locations"): `<data-root>/decks/<id>/deck.json`, its words in
// deck order with the audio it brought in `media/` beside it. Server-wide, as the library: every
// profile takes it as a course's deck.
import { z } from "zod";
import { format } from "./common.ts";
import { Gender, LexemeKey, Slug } from "./keys.ts";
import { Lang } from "./lang.ts";

export const DECK_FORMAT = 1;

/** An imported deck's id: its title's slug and a short hash (`deutsch-a1-3f9c2a`); its folder's name. */
export const DeckId = Slug.max(80).brand<"DeckId">();
export type DeckId = z.infer<typeof DeckId>;

/** A file inside a deck's folder: its own media (`media/<name>`). */
export const DeckMediaPath = z.string().regex(/^media\/[^/\\]+$/);

/** An example sentence a deck brings with its word: in the word's language, with its translation and
 *  audio when the deck has them. */
export const DeckExample = z.strictObject({
  sentence: z.string().min(1),
  translation: z.string().optional(),
  audio: DeckMediaPath.optional(),
});
export type DeckExample = z.infer<typeof DeckExample>;

/** One word of a deck, made from one note. */
export const DeckWord = z.strictObject({
  /** The note's guid: the same note keeps it in every export of the deck. */
  key: z.string().min(1).max(200),
  /** The word as learnt: "der Abend". */
  target: z.string().min(1),
  lexeme: LexemeKey,
  gender: Gender.optional(),
  /** Plural form as the deck gives it: "die Abende". */
  plural: z.string().optional(),
  translation: z.string().optional(),
  /** The note's tags (Anki's: `thema::familie`). */
  tags: z.array(z.string()),
  audio: DeckMediaPath.optional(),
  examples: z.array(DeckExample).optional(),
});
export type DeckWord = z.infer<typeof DeckWord>;

/** `decks/<id>/deck.json`. */
export const Deck = z.strictObject({
  format: format(DECK_FORMAT),
  id: DeckId,
  title: z.string().min(1).max(200),
  /** The language the words are in. */
  lang: Lang,
  /** The language their translations are in. */
  translationLang: Lang,
  /** The file it was imported from, and when (epoch ms). */
  source: z.strictObject({ file: z.string().max(400), importedAt: z.number().int() }),
  words: z.array(DeckWord).min(1),
});
export type Deck = z.infer<typeof Deck>;
