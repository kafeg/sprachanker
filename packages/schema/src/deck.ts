// An imported deck (04, "Decks"; 05, "Locations"): `<data-root>/decks/<id>/deck.json`, its words in
// deck order with the audio it brought in `media/` beside it. Server-wide, as the library: every
// profile takes it as a course's deck. Beside it, and in a course's deck folder, `extras.json`: what
// the server made for the words (audio read aloud, examples).
import { z } from "zod";
import { format } from "./common.ts";
import { type CourseKey, Gender, LexemeKey, Slug } from "./keys.ts";
import { Lang } from "./lang.ts";

export const DECK_FORMAT = 1;
export const DECK_EXTRAS_FORMAT = 1;

/** An imported deck's id: its title's slug and a short hash (`deutsch-a1-3f9c2a`); its folder's name. */
export const DeckId = Slug.max(80).brand<"DeckId">();
export type DeckId = z.infer<typeof DeckId>;

/** A deck's folder in `<data-root>/decks/`: an imported deck's id, or a course's (its words' extras:
 *  `course~<series>~<course>`). */
export const DeckFolder = z.union([
  DeckId,
  z.string().regex(/^course~[a-z0-9]+(?:[.-][a-z0-9]+)*~[a-z0-9]+(?:-[a-z0-9]+)*$/),
]);

/** A course's deck folder: `dw.nicos-weg/a1` → `course~dw.nicos-weg~a1`, the same in every edition
 *  (what it keeps is of the words, in the language they teach). */
export const courseDeckFolder = (course: CourseKey | string) =>
  `course~${course.replace("/", "~")}`;

/** A card's source key for a deck's word: the deck and the note's guid (`deck:<id>/<guid>`), so two
 *  decks sharing a note never share a card's source. */
export const deckSourceKey = (deck: DeckId, key: string) => `deck:${deck}/${key}`;

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

/** A word read aloud by the server's engine (a word without audio of its own): the file in the deck's
 *  folder, the engine and voice that read it, and the text read — a word changed since is read again. */
export const DeckReadAudio = z.strictObject({
  path: DeckMediaPath,
  engine: z.enum(["piper", "qwen"]),
  voice: z.string().min(1),
  text: z.string().min(1),
  /** When it was read (epoch ms). */
  made: z.number().int(),
});
export type DeckReadAudio = z.infer<typeof DeckReadAudio>;

/** Example sentences the AI wrote for a word (04, "A deck's words given examples"), with their
 *  translations in one language: the model that wrote them and when. */
export const DeckMadeExamples = z.strictObject({
  items: z
    .array(
      z.strictObject({
        sentence: z.string().min(1),
        translation: z.string().min(1),
        /** Words of the sentence beyond those the learner was assumed to know, translated. */
        glossary: z.array(z.strictObject({ word: z.string(), translation: z.string() })).optional(),
        /** The word as the sentence uses it ("kann" of "können"). */
        form: z.string().optional(),
      }),
    )
    .min(1)
    .max(5),
  model: z.string(),
  /** When they were written (epoch ms). */
  made: z.number().int(),
});
export type DeckMadeExamples = z.infer<typeof DeckMadeExamples>;

/** `decks/<folder>/extras.json`: what the server made for a deck's words, by lexeme key (a deck's
 *  cards are one per lexeme): the audio read aloud, the examples by the language they are translated
 *  into (a course's cards are in its editions' languages). */
export const DeckExtras = z.strictObject({
  format: format(DECK_EXTRAS_FORMAT),
  words: z.record(
    z.string().min(1).max(200),
    z.strictObject({
      audio: DeckReadAudio.optional(),
      examples: z.record(Lang, DeckMadeExamples).optional(),
    }),
  ),
});
export type DeckExtras = z.infer<typeof DeckExtras>;
