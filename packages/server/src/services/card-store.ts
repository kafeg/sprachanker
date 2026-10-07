// Cards and their faces (04, "Spaced repetition"; 05): the one module on the `cards` and `card_state`
// tables, as the run store is on runs and events. A card is a note (one per lexeme) whose faces are
// Anki's cards; each face keeps its FSRS state, bury, suspension and flag. Stored JSON is read with its
// schema; a card whose display no longer reads is left out of lists and logged.
import {
  CardDisplay,
  type CardFace,
  FaceState,
  type LexemeKey,
  parseLessonKey,
  parseLexemeKey,
} from "@sprachanker/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { cardState, cards } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";
import { readStored } from "./run-store.ts";

export type CardRow = typeof cards.$inferSelect;
export type StateRow = typeof cardState.$inferSelect;
/** A note with what is read from it once: its display, course and language. */
export type Note = CardRow & { display: CardDisplay; course: string; lang: string };

export function createCardStore(db: ProfileDb) {
  /** A row with its display read; undefined when the display no longer reads. */
  const noteOf = (row: CardRow): Note | undefined => {
    const display = readStored(row.displayCacheJson, CardDisplay, `card ${row.id}`);
    if (!display) return undefined;
    return {
      ...row,
      display,
      course: parseLessonKey(display.lessonKey).course,
      lang: row.lexemeKey ? parseLexemeKey(row.lexemeKey as LexemeKey).lang : "",
    };
  };
  const notes = (rows: CardRow[]) => rows.flatMap((r) => noteOf(r) ?? []);

  const self = {
    /** Runs `fn` in one transaction. */
    atomic<T>(fn: () => T): T {
      return db.transaction(() => fn());
    },

    facesOf: (row: CardRow) => row.faces.split(",") as CardFace[],

    /** A face's FSRS state, if it was ever answered. */
    stateOf: (row: StateRow | undefined) =>
      readStored(row?.fsrsJson ?? null, FaceState, `state of card ${row?.cardId}:${row?.face}`),

    /** One note by id; 404 when there is none. */
    note(cardId: string): Note {
      const row = db.select().from(cards).where(eq(cards.id, cardId)).get();
      const note = row && noteOf(row);
      if (!note) throw new ServiceError("no_such_card", 404);
      return note;
    },

    /** One of the note's faces; 404 when the note does not have it. */
    checkFace(note: CardRow, face: CardFace) {
      if (!self.facesOf(note).includes(face)) throw new ServiceError("no_such_card", 404);
    },

    /** Every note in the order it was made (its position in a deck). */
    all: () => notes(db.select().from(cards).orderBy(asc(cards.createdAt), asc(cards.id)).all()),

    /** The notes made in a run (a lesson run's "Words" step), in the order they were made. */
    madeIn: (runId: string) =>
      notes(
        db
          .select()
          .from(cards)
          .where(eq(cards.originRunId, runId))
          .orderBy(asc(cards.createdAt), asc(cards.id))
          .all(),
      ),

    /** The note of a lexeme, or of a course's word (its source key), translated into a language. */
    byLexeme: (lexemeKey: string, lang: string) =>
      db
        .select()
        .from(cards)
        .where(and(eq(cards.lexemeKey, lexemeKey), eq(cards.translationLang, lang)))
        .get(),
    bySource: (sourceKey: string, lang: string) =>
      db
        .select()
        .from(cards)
        .where(and(eq(cards.sourceKey, sourceKey), eq(cards.translationLang, lang)))
        .get(),
    /** Every row as stored (relinking reads them all, a display that no longer reads included). */
    rows: () => db.select().from(cards).all(),

    insert: (values: typeof cards.$inferInsert) => db.insert(cards).values(values).run(),

    /** Sets fields of a note: its lexeme, translation language, suspension (Anki: suspend note) or mark. */
    setNote: (
      cardId: string,
      values: Partial<Pick<CardRow, "lexemeKey" | "translationLang" | "suspended" | "marked">>,
    ) => db.update(cards).set(values).where(eq(cards.id, cardId)).run(),

    /** The face rows of some notes (all when none are named), by `<card>:<face>`. */
    states(cardIds?: string[]) {
      const out = new Map<string, StateRow>();
      for (const r of db
        .select()
        .from(cardState)
        .where(cardIds ? inArray(cardState.cardId, cardIds) : undefined)
        .all())
        out.set(`${r.cardId}:${r.face}`, r);
      return out;
    },

    /** Sets fields of a face's row, made when the face has none yet (a new face). */
    setFace: (cardId: string, face: CardFace, values: Partial<StateRow>) =>
      db
        .insert(cardState)
        .values({ cardId, face, ...values })
        .onConflictDoUpdate({ target: [cardState.cardId, cardState.face], set: values })
        .run(),

    /** Brings back the buried faces of some notes. */
    unbury: (cardIds: string[]) =>
      db
        .update(cardState)
        .set({ buriedUntil: null })
        .where(inArray(cardState.cardId, cardIds))
        .run(),
  };
  return self;
}
export type CardStore = ReturnType<typeof createCardStore>;
