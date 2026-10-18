// Imported decks: the server's list, a deck file uploaded and previewed, its import by
// the upload's id, a deck deleted; any deck as a file (`.sprachanker-deck`): exported, previewed and
// imported; any deck as an Anki package (.apkg), exported; any deck's words read aloud by the server
// (polled while it reads). Taking and leaving one is the profile's (cards.ts).
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useRef } from "react";
import { DECK_AUDIO, readCardsAgain } from "./cards.ts";
import { api, json, sendBinary } from "./client.ts";
import { downloadReady, startDownload } from "./files.ts";

export const useImportedDecks = () =>
  useQuery({ queryKey: ["imported-decks"], queryFn: () => json(api.decks.$get()) });

/** What the server says of a deck file uploaded: an .apkg's deck (`DeckPreview`), or a deck file of
 *  the app's own (`DeckFilePreview`: it has a `kind`) — told by its content. */
type AnyPreview = InferResponseType<typeof api.decks.preview.$post, 200>;
export type DeckPreview = Exclude<AnyPreview, { kind: unknown }>;
export type DeckFilePreview = Extract<AnyPreview, { kind: unknown }>;
export type ImportedDeck = InferResponseType<typeof api.decks.import.$post, 200>;

/** A deck file uploaded (kept by the server until imported). An .apkg: its deck's name, words (with
 *  audio, with examples), the languages its fields are named by, the first words, the deck it
 *  updates. One of the app's own: its deck's kind, name, languages, words, whether it joins a deck
 *  here and whether its course is not here yet. */
export const previewDeck = (file: File) =>
  sendBinary<AnyPreview>("/api/decks/preview", file, "application/octet-stream");

/** An uploaded deck file let go unimported (its sheet closed); a failure is no matter (a day later the
 *  server lets it go itself). */
export const discardDeckUpload = (upload: string) =>
  json(api.decks.uploads[":upload"].$delete({ param: { upload } })).catch(() => undefined);

/** After a deck was imported: the decks, the decks to take, their audio and the cards read anew. */
const readDecksAgain = (client: QueryClient) =>
  Promise.all([
    client.invalidateQueries({ queryKey: ["imported-decks"] }),
    client.invalidateQueries({ queryKey: [DECK_AUDIO] }),
    readCardsAgain(client),
  ]);

/** An uploaded deck file imported; the decks and the decks to take read anew. */
export function useImportDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.decks.import.$post>[0]["json"]) =>
      json(api.decks.import.$post({ json: input })),
    onSuccess: () => readDecksAgain(client),
  });
}

/** Where a deck's file made ready is downloaded (once). */
export const deckExportUrl = (id: string) => `/api/decks/export/${id}`;

/** A deck the learner sees (`course:<key>`, `deck:<id>`) as a file: made ready on the server, asked
 *  after (one gone meanwhile is an error, never the server's answer saved as the file), then
 *  downloaded under its own name. Its name and size. */
export function useExportDeck(
  download: (url: string, fileName: string) => void | Promise<void> = startDownload,
) {
  return useMutation({
    mutationFn: async (scope: string) => {
      const ready = await json(api.decks.export.$post({ json: { scope } }));
      await downloadReady(deckExportUrl(ready.id), "deck_export_gone");
      await download(deckExportUrl(ready.id), ready.fileName);
      return ready;
    },
  });
}

/** Where a deck's Anki package made ready is downloaded (once). */
export const deckApkgUrl = (id: string) => `/api/decks/apkg/${id}`;

/** A deck the learner sees as an Anki package (.apkg) — a course's in an edition —, named there as
 *  the app names it: made ready, asked after, then downloaded under its own name. Its name, size, its
 *  words and those with audio. */
export function useExportApkg(
  download: (url: string, fileName: string) => void | Promise<void> = startDownload,
) {
  return useMutation({
    mutationFn: async (input: { scope: string; edition?: string; title: string }) => {
      const ready = await json(api.decks.apkg.$post({ json: input }));
      await downloadReady(deckApkgUrl(ready.id), "deck_export_gone");
      await download(deckApkgUrl(ready.id), ready.fileName);
      return ready;
    },
  });
}

/** A deck file previewed imported; the decks read anew. */
export function useImportDeckFile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (upload: string) => json(api.decks.file.import.$post({ json: { upload } })),
    onSuccess: () => readDecksAgain(client),
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
