// The learner's day of card answers as Anki keeps it (04, "Spaced repetition"): the answers not taken
// back, what each deck has used of its daily limits, the answer Undo takes back, and the face just
// taken back (shown next). Pure: the caller passes the day's card events.
import type { CardFace, CardReviewPayload, CardUndoPayload } from "@sprachanker/schema";

/** A `card_review` or `card_undo` event of the day. */
export type CardEvent =
  | { id: string; type: "card_review"; cardId: string; payload: CardReviewPayload }
  | { id: string; type: "card_undo"; cardId: string; payload: CardUndoPayload };

export interface CardAnswer {
  id: string;
  cardId: string;
  face: CardFace;
  review: CardReviewPayload;
}

/** The day read from its card events, newest first. */
export function cardDay(events: CardEvent[]) {
  const undone = new Set(events.flatMap((e) => (e.type === "card_undo" ? [e.payload.review] : [])));
  const answers: CardAnswer[] = events.flatMap((e) =>
    e.type === "card_review" && !undone.has(e.id)
      ? [{ id: e.id, cardId: e.cardId, face: e.payload.face, review: e.payload }]
      : [],
  );
  const latest = events[0];
  const takenBack =
    latest?.type === "card_undo"
      ? events.find((e) => e.id === latest.payload.review && e.type === "card_review")
      : undefined;
  return {
    /** Today's answers not taken back, newest first. */
    answers,
    /** The answer Undo takes back: today's latest not taken back yet. */
    undoable: answers[0],
    /** The face whose answer was just taken back, when nothing was answered since (shown next). */
    justUndone:
      takenBack?.type === "card_review"
        ? { cardId: takenBack.cardId, face: takenBack.payload.face }
        : undefined,
    /** What a deck's cards used today: new faces introduced and review faces answered (Anki's limits
     *  are the deck's own, so German answers do not use up English). */
    used(cardIds: Set<string>) {
      let fresh = 0;
      let reviews = 0;
      for (const a of answers) {
        if (!cardIds.has(a.cardId)) continue;
        if (!a.review.stateBefore) fresh++;
        else if (a.review.stateBefore.state === 2) reviews++;
      }
      return { fresh, reviews };
    },
  };
}
