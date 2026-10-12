// Imported decks (04, "Decks"): the server's list, a deck file uploaded and previewed, its import by
// the upload's id, a deck deleted; any deck's words read aloud by the server (polled while it reads).
// Taking and leaving one is the profile's (cards.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useRef } from "react";
import { DECK_AUDIO, readCardsAgain } from "./cards.ts";
import { api, json, sendBinary } from "./client.ts";

export const useImportedDecks = () =>
  useQuery({ queryKey: ["imported-decks"], queryFn: () => json(api.decks.$get()) });

export type DeckPreview = InferResponseType<typeof api.decks.preview.$post, 200>;
export type ImportedDeck = InferResponseType<typeof api.decks.import.$post, 200>;

/** A deck file uploaded (kept by the server until imported): its deck's name, words (with audio,
 *  with examples), the languages its fields are named by, the first words, the deck it updates. */
export const previewDeck = (file: File) =>
  sendBinary<DeckPreview>("/api/decks/preview", file, "application/octet-stream");

/** An uploaded deck file let go unimported (its sheet closed); a failure is no matter (a day later the
 *  server lets it go itself). */
export const discardDeckUpload = (upload: string) =>
  json(api.decks.uploads[":upload"].$delete({ param: { upload } })).catch(() => undefined);

/** An uploaded deck file imported; the decks and the decks to take read anew. */
export function useImportDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.decks.import.$post>[0]["json"]) =>
      json(api.decks.import.$post({ json: input })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["imported-decks"] }),
        client.invalidateQueries({ queryKey: [DECK_AUDIO] }),
        readCardsAgain(client),
      ]),
  });
}

export type DeckAudioState = InferResponseType<typeof api.decks.audio.$get, 200>;

/** Whether a deck's job is reading (or finishing the words under way once stopped). */
export const reading = (state: DeckAudioState | undefined) =>
  state?.job?.status === "running" || state?.job?.status === "stopping";

/** A deck's words read aloud (`scope`: `course:<key>` or `deck:<id>`): how many have audio, the engine
 *  that would read the rest, the job — polled while it runs; when it ends, the cards are read anew
 *  (they play what it read). */
export function useDeckAudio(scope: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [DECK_AUDIO, scope],
    queryFn: () => json(api.decks.audio.$get({ query: { scope } })),
    refetchInterval: (q) => (reading(q.state.data) ? 1500 : false),
  });
  const going = reading(query.data);
  const before = useRef(going);
  useEffect(() => {
    if (before.current && !going) void readCardsAgain(client);
    before.current = going;
  }, [going, client]);
  return query;
}

/** Reading a deck's words aloud started (`again`: what was read removed first) or stopped, what was
 *  read removed (the cards read anew: they no longer play it); the state the server answers with is
 *  shown. */
export function useDeckAudioActions(scope: string) {
  const client = useQueryClient();
  const onSuccess = (state: DeckAudioState) => client.setQueryData([DECK_AUDIO, scope], state);
  return {
    start: useMutation({
      mutationFn: (again?: boolean) =>
        json(api.decks.audio.$post({ json: { scope, ...(again && { again }) } })),
      onSuccess: (state: DeckAudioState, again) => {
        onSuccess(state);
        if (again) void readCardsAgain(client);
      },
    }),
    stop: useMutation({
      mutationFn: () => json(api.decks.audio.$delete({ query: { scope } })),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: () => json(api.decks.audio.remove.$post({ json: { scope } })),
      onSuccess: (state: DeckAudioState) => {
        onSuccess(state);
        void readCardsAgain(client);
      },
    }),
  };
}

export function useDeleteDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => json(api.decks[":id"].$delete({ param: { id } })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["imported-decks"] }),
        readCardsAgain(client),
      ]),
  });
}
