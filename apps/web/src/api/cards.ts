// Review cards (04): a lesson's words made cards, the decks, My words, a word, the queue and what the
// reviewer does to cards.
import type { CardFace, CardRating, LessonKey } from "@sprachanker/schema";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import { api, json } from "./client.ts";

/** Makes cards of a lesson's words (one per word; a word met before keeps its card). */
export function useMakeCards() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: { series: string; lessonKey: LessonKey; edition: string }) =>
      json(api.cards.lesson.$post({ json: request })),
    onSuccess: () => readCardsAgain(client),
  });
}

/** Every query that shows cards: the queue, the decks and the decks to take, My words, a word. */
const CARD_QUERIES = ["study", "decks", "deck-offers", "words", "word"];

/** The card lists read again after cards change; resolves once they are. */
export const readCardsAgain = (client: QueryClient) =>
  client.invalidateQueries({ predicate: (q) => CARD_QUERIES.includes(String(q.queryKey[0])) });

/** Decks: each language, and under it each course and imported deck, with Anki's three counts. */
export const useDecks = () =>
  useQuery({ queryKey: ["decks"], queryFn: () => json(api.cards.decks.$get()) });

/** Decks to take: each of My courses' words and each imported deck, with how many are cards already. */
export const useDeckOffers = () =>
  useQuery({ queryKey: ["deck-offers"], queryFn: () => json(api.cards.decks.offers.$get()) });

/** What is made for a deck's words, counted over the words taken: their audio, their examples (the
 *  assistant's) — read anew when a deck's words are taken or left. */
const DECK_MADE = ["deck-audio", "deck-examples"];

/** Taking or leaving a deck (a course's or an imported one), and more new cards today: every card list
 *  is read anew, and what is made for the decks' words. */
export function useDeckActions() {
  const client = useQueryClient();
  const fresh = () =>
    void Promise.all([
      readCardsAgain(client),
      client.invalidateQueries({ predicate: (q) => DECK_MADE.includes(String(q.queryKey[0])) }),
    ]);
  return {
    take: useMutation({
      mutationFn: (input: Parameters<typeof api.cards.decks.take.$post>[0]["json"]) =>
        json(api.cards.decks.take.$post({ json: input })),
      onSuccess: fresh,
    }),
    leave: useMutation({
      mutationFn: (input: Parameters<typeof api.cards.decks.leave.$post>[0]["json"]) =>
        json(api.cards.decks.leave.$post({ json: input })),
      onSuccess: fresh,
    }),
    more: useMutation({
      mutationFn: (input: Parameters<typeof api.cards.decks.more.$post>[0]["json"]) =>
        json(api.cards.decks.more.$post({ json: input })),
      onSuccess: fresh,
    }),
  };
}

/** My words: every word with cards, newest first. */
export const useWords = () =>
  useQuery({ queryKey: ["words"], queryFn: () => json(api.cards.$get()) });
export type MyWord = NonNullable<ReturnType<typeof useWords>["data"]>["words"][number];

/** One word for its sheet: each face's state and the answers given to it. */
export const useWord = (cardId: string | undefined) =>
  useQuery({
    queryKey: ["word", cardId],
    enabled: !!cardId,
    queryFn: () => json(api.cards[":id"].$get({ param: { id: cardId as string } })),
  });

/** What to study now in a scope ("all", "lang:de", "course:…", "lesson:…"). */
export const useStudy = (scope: string) =>
  useQuery({
    queryKey: ["study", scope],
    queryFn: () => json(api.cards.study.$get({ query: { scope } })),
  });

/**
 * What the reviewer does to cards: rate, undo, bury, suspend, flag, mark. Each reads the queue anew,
 * and its `onSuccess` callbacks run once the new queue is in (so the next card shows straight away).
 */
export function useCardActions() {
  const client = useQueryClient();
  const onSuccess = () => readCardsAgain(client);
  const id = (cardId: string) => ({ param: { id: cardId } });
  const rate = useMutation({
    onSuccess,
    // Refused (rated meanwhile on another device): the queue as it is now.
    onError: onSuccess,
    mutationFn: (r: {
      cardId: string;
      face: CardFace;
      rating: CardRating;
      reps: number;
      /** How long the card was on screen before the rating. */
      ms: number;
    }) =>
      json(
        api.cards[":id"].review.$post({
          ...id(r.cardId),
          // The answer's own id: sent again after a lost response, it is not applied twice.
          json: { id: ulid(), face: r.face, rating: r.rating, reps: r.reps, ms: r.ms },
        }),
      ),
  });
  const undo = useMutation({
    onSuccess,
    mutationFn: (scope: string) => json(api.cards.undo.$post({ json: { scope } })),
  });
  const bury = useMutation({
    onSuccess,
    mutationFn: (r: { cardId: string; face?: CardFace }) =>
      json(api.cards[":id"].bury.$post({ ...id(r.cardId), json: { face: r.face } })),
  });
  const unbury = useMutation({
    onSuccess,
    mutationFn: (scope: string) => json(api.cards.unbury.$post({ json: { scope } })),
  });
  const suspend = useMutation({
    onSuccess,
    // Suspends (or, with `suspended: false`, restores) a face or the whole note.
    mutationFn: ({
      suspended = true,
      ...r
    }: {
      cardId: string;
      face?: CardFace;
      suspended?: boolean;
    }) =>
      json(api.cards[":id"].suspend.$put({ ...id(r.cardId), json: { suspended, face: r.face } })),
  });
  const flag = useMutation({
    onSuccess,
    mutationFn: (r: { cardId: string; face: CardFace; flag: number }) =>
      json(api.cards[":id"].flag.$put({ ...id(r.cardId), json: { face: r.face, flag: r.flag } })),
  });
  const mark = useMutation({
    onSuccess,
    mutationFn: (r: { cardId: string; marked: boolean }) =>
      json(api.cards[":id"].mark.$put({ ...id(r.cardId), json: { marked: r.marked } })),
  });
  return { rate, undo, bury, unbury, suspend, flag, mark };
}
