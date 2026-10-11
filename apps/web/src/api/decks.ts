// Imported decks (04, "Decks"): the server's list, a deck file uploaded and previewed, its import by
// the upload's id, a deck deleted. Taking and leaving one is the profile's (cards.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { readCardsAgain } from "./cards.ts";
import { api, json, sendBinary } from "./client.ts";

export const useImportedDecks = () =>
  useQuery({ queryKey: ["imported-decks"], queryFn: () => json(api.decks.$get()) });

export type DeckPreview = InferResponseType<typeof api.decks.preview.$post, 200>;

/** A deck file uploaded (kept by the server until imported): its deck's name, words (with audio,
 *  with examples), the languages its fields are named by, the first words, the deck it updates. */
export const previewDeck = (file: File) =>
  sendBinary<DeckPreview>("/api/decks/preview", file, "application/octet-stream");

/** An uploaded deck file imported; the decks and the decks to take read anew. */
export function useImportDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.decks.import.$post>[0]["json"]) =>
      json(api.decks.import.$post({ json: input })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["imported-decks"] }),
        readCardsAgain(client),
      ]),
  });
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
