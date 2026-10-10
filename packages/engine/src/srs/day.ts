// The learner's day of card answers as Anki keeps it (04, "Spaced repetition"): the answers not taken
// back (Undo takes back a deck's latest), what each deck has used of its daily limits, and the face just
// taken back (shown next). Pure: the caller passes the day's card events.
import type { CardFace, CardReviewPayload, TypedEvent } from "@sprachanker/schema";
import { inReview } from "./state.ts";

/** A `card_review` or `card_undo` event of the day (always about a card). */
export type CardEvent = Extract<TypedEvent, { type: "card_review" | "card_undo" }> & {
  cardId: string;
};

export interface CardAnswer {
  id: string;
  ts: number;
  cardId: string;
  face: CardFace;
  review: CardReviewPayload;
}

/** Card answers taken back (Anki: undo): they count nowhere — not in the day, not in study days. */
export const undoneReviews = (events: ReadonlyArray<CardEvent | TypedEvent>) =>
  new Set(events.flatMap((e) => (e.type === "card_undo" ? [e.payload.review] : [])));

/** The day read from its card events, newest first (also any card events: a word's answers). */
export function cardDay(events: CardEvent[]) {
  const undone = undoneReviews(events);
  const answers: CardAnswer[] = events.flatMap((e) =>
    e.type === "card_review" && !undone.has(e.id)
      ? [{ id: e.id, ts: e.ts, cardId: e.cardId, face: e.payload.face, review: e.payload }]
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
        else if (inReview(a.review.stateBefore)) reviews++;
      }
      return { fresh, reviews };
    },
  };
}
