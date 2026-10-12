// My words: the learner's words with cards, newest first — what each card shows (as a language's
// queue shows it: a course's entry over an imported deck's, cards.ts), its language, deck and state,
// when it is next due — and one word for its sheet with each face and its answers.
import { type CardEvent, cardDay, faceStage, wordState } from "@sprachanker/engine";
import type { CardDisplay, CardFace, FaceState } from "@sprachanker/schema";
import type { CardStore, Note, StateRow } from "./card-store.ts";
import type { RunStore } from "./run-store.ts";

export function createWords(deps: {
  cards: CardStore;
  store: RunStore;
  /** What a card shows in a scope (cards.ts). */
  shown: (note: Note, scope: string, notes?: Note[]) => Promise<CardDisplay>;
}) {
  const { cards, store } = deps;

  /** A word as My words lists it; a suspended face is not due. */
  const wordOf = async (note: Note, states: Map<string, StateRow>, notes?: Note[]) => {
    const byFace: Partial<Record<CardFace, FaceState>> = {};
    const dues: number[] = [];
    for (const { face, row, state } of cards.facesWithState(note, states)) {
      if (!state) continue;
      byFace[face] = state;
      if (!row?.suspended) dues.push(state.due);
    }
    return {
      cardId: note.id,
      lexemeKey: note.lexemeKey,
      display: await deps.shown(note, `lang:${note.lang}`, notes),
      lang: note.lang,
      deck: note.deck,
      suspended: !!note.suspended,
      marked: !!note.marked,
      state: wordState(byFace),
      due: !note.suspended && dues.length ? Math.min(...dues) : null,
    };
  };

  return {
    /** The learner's words, newest first. */
    list() {
      const states = cards.states();
      const notes = cards.all();
      return Promise.all([...notes].reverse().map((n) => wordOf(n, states, notes)));
    },

    /** One word for its sheet: the list's fields, each face's state, and the answers given to it,
     *  newest first (answers taken back left out). */
    async word(cardId: string) {
      const note = cards.note(cardId);
      const states = cards.states([cardId]);
      const faces = cards.facesWithState(note, states).map(({ face, row, state: s }) => {
        return {
          face,
          stage: faceStage(s),
          due: s?.due ?? null,
          lapses: s?.lapses ?? 0,
          suspended: !!row?.suspended,
          flag: row?.flag ?? 0,
        };
      });
      const events = store.eventsWhere({ types: ["card_review", "card_undo"], cardId });
      // Read as the day is: an answer taken back is no answer.
      const answers = cardDay(events as CardEvent[]).answers.map((a) => ({
        ts: a.ts,
        face: a.face,
        rating: a.review.rating,
      }));
      return { ...(await wordOf(note, states)), faces, answers };
    },
  };
}
export type Words = ReturnType<typeof createWords>;
