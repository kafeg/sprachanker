// Imported decks (04, "Decks"): the server's list, a deck file's preview, its import, a deck deleted.
// Taking and leaving one is the profile's (cards.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { readCardsAgain } from "./cards.ts";
import { api, json, sendBinary } from "./client.ts";

export const useImportedDecks = () =>
  useQuery({ queryKey: ["imported-decks"], queryFn: () => json(api.decks.$get()) });

export type DeckPreview = InferResponseType<typeof api.decks.preview.$post, 200>;
type Imported = InferResponseType<typeof api.decks.import.$post, 200>;

/** What a deck file holds: its deck's name, how many words (with audio), the first of them. */
export const previewDeck = (file: File) =>
  sendBinary<DeckPreview>("/api/decks/preview", file, "application/octet-stream");

/** A deck file imported; the decks and the decks to take read anew. */
export function useImportDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; title: string; lang: string; translationLang: string }) =>
      sendBinary<Imported>(
        `/api/decks/import?${new URLSearchParams({
          title: input.title,
          lang: input.lang,
          translationLang: input.translationLang,
          file: input.file.name,
        })}`,
        input.file,
        "application/octet-stream",
      ),
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
