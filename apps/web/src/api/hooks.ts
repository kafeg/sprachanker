// TanStack Query hooks over the API.
import {
  type CardFace,
  type CardRating,
  CLIENT_HEADERS,
  type ItemKey,
  type LearnerSettingKey,
  type LessonKey,
  type SettingRead,
  settingOf,
} from "@sprachanker/schema";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ulid } from "ulid";
import { api, apiError, json, sendBinary } from "./client.ts";

/** The server's version (and that it answers). */

/** Queries whose data no learner action changes (content, the course's files, the app, the standing
 *  prompts): a progress reset leaves them. */
export const STATIC = { static: true } as const;

export const useAppInfo = () =>
  useQuery({
    queryKey: ["health"],
    meta: STATIC,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => json(api.health.$get()),
  });

export const useCourses = () =>
  useQuery({ queryKey: ["courses"], queryFn: () => json(api.courses.$get()) });

export const useCourseMap = (series: string, course: string, edition: string | undefined) =>
  useQuery({
    queryKey: ["course", series, course, edition],
    enabled: !!edition,
    queryFn: () => json(api.course.$get({ query: { series, course, edition: edition as string } })),
  });

export const useLesson = (series: string, key: string, edition: string | undefined) =>
  useQuery({
    queryKey: ["lesson", series, key, edition],
    meta: STATIC,
    enabled: !!edition,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => json(api.lesson.$get({ query: { series, key, edition: edition as string } })),
  });

export type Settings = Record<string, unknown>;
export const useSettings = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: () => json(api.settings.$get()) as Promise<Settings>,
  });

/** A preference as the profile has it: set, or its default (schema `SETTING_DEFAULTS`). */
export const useSetting = <K extends LearnerSettingKey>(key: K): SettingRead<K> =>
  settingOf(useSettings().data, key);

export function useSetSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      json(api.settings.$put({ json: { key, value } })),
    // Applied at once, so a screen opened right after (e.g. a course in the chosen edition) sees it;
    // a read in flight could bring the old value back, so it is cancelled.
    onMutate: async ({ key, value }) => {
      await client.cancelQueries({ queryKey: ["settings"] });
      const before = client.getQueryData<Settings>(["settings"]);
      client.setQueryData(["settings"], (old: Settings | undefined) => ({ ...old, [key]: value }));
      return { key, had: before && key in before, was: before?.[key] };
    },
    // Not stored: the value goes back to what it was.
    onError: (_error, _vars, saved) => {
      if (!saved) return;
      client.setQueryData(["settings"], (old: Settings | undefined) => {
        const next = { ...old };
        if (saved.had) next[saved.key] = saved.was;
        else delete next[saved.key];
        return next;
      });
    },
    // Only this key from the answer: another change still in flight keeps its own value.
    onSuccess: (settings, { key }) =>
      client.setQueryData(["settings"], (old: Settings | undefined) => {
        const next = { ...old };
        if (key in settings) next[key] = settings[key];
        else delete next[key];
        return next;
      }),
  });
}

/** A course's integrity and counts (verify) for its page: read once per session — it reads every
 *  file of the course (a download's end reads it again). */
export const useCourseCheck = (series: string, course: string) =>
  useQuery({
    queryKey: ["course-check", series, course],
    meta: STATIC,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => json(api.course.check.$get({ query: { series, course } })),
  });

type DownloadsState = Awaited<ReturnType<typeof fetchDownloads>>;
const fetchDownloads = () => json(api.downloads.$get());
const active = (state: DownloadsState | undefined) =>
  !!state?.jobs.some((j) => j.status === "queued" || j.status === "running");

/** All downloads of the server; polled while one is queued or running. */
export const useDownloads = () =>
  useQuery({
    queryKey: ["downloads"],
    queryFn: fetchDownloads,
    refetchInterval: (q) => (active(q.state.data) ? 1500 : false),
  });

/** The latest download of a course, and whether downloads are possible at all. */
export function useCourseDownload(series: string, course: string) {
  const downloads = useDownloads();
  return {
    available: !!downloads.data?.available,
    job: downloads.data?.jobs.find((j) => j.series === series && j.course === course),
  };
}

/**
 * Keeps the screens current while courses download (mounted once, in the app shell). Lists are read
 * again when a download changes phase — a course appears once its pages are normalised — and a
 * course's files, map and lessons when its download ends; not on every poll.
 */
export function useDownloadsWatch() {
  const client = useQueryClient();
  const jobs = useDownloads().data?.jobs ?? [];
  const phases = jobs.map((j) => `${j.id}:${j.status}:${j.progress?.phase ?? ""}`).join("|");
  const ended = jobs
    .filter((j) => j.finishedAt)
    .map((j) => j.id)
    .join("|");
  useEffect(() => {
    if (!phases) return;
    void client.invalidateQueries({ queryKey: ["courses"] });
    void client.invalidateQueries({ queryKey: ["catalog"] });
  }, [phases, client]);
  useEffect(() => {
    if (!ended) return;
    for (const key of ["course", "course-check", "lesson", "storage"])
      void client.invalidateQueries({ queryKey: [key] });
  }, [ended, client]);
}

/** Every course the providers offer, with its state (available, downloading, incomplete, ready). */
export const useCatalog = () =>
  useQuery({ queryKey: ["catalog"], meta: STATIC, queryFn: () => json(api.catalog.$get()) });

/** Downloads a course, completes it or syncs it with its source (one idempotent job). */
export function useStartDownload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: { series: string; course: string }) =>
      json(api.downloads.$post({ json: target })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["downloads"] });
      void client.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

/** The data folder and the space each series takes. */
export const useStorage = () =>
  useQuery({ queryKey: ["storage"], queryFn: () => json(api.storage.$get()) });

/** Resets the progress of a course, or of one of its lessons (the screens confirm first). */
export function useResetProgress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: { series: string; course: string; lesson?: LessonKey }) =>
      json(api.progress.reset.$post({ json: target })),
    // Progress shows in many places (course list and map, tutor, reviews): read it all again — not
    // the course content and its file check, which a reset does not change.
    onSuccess: () => void client.invalidateQueries({ predicate: (q) => q.meta?.static !== true }),
  });
}

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
const readCardsAgain = (client: QueryClient) =>
  client.invalidateQueries({ predicate: (q) => CARD_QUERIES.includes(String(q.queryKey[0])) });

/** Decks: each language, and under it each course, with Anki's three counts. */
export const useDecks = () =>
  useQuery({ queryKey: ["decks"], queryFn: () => json(api.cards.decks.$get()) });

/** Decks to take: each installed course's words with how many are cards already. */
export const useDeckOffers = () =>
  useQuery({ queryKey: ["deck-offers"], queryFn: () => json(api.cards.decks.offers.$get()) });

/** Taking or leaving a course's deck, and more new cards today: every card list is read anew. */
export function useDeckActions() {
  const client = useQueryClient();
  const fresh = () => void readCardsAgain(client);
  return {
    take: useMutation({
      mutationFn: (input: { series: string; course: string; edition: string }) =>
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
    mutationFn: (r: { cardId: string; face: CardFace; rating: CardRating; reps: number }) =>
      json(
        api.cards[":id"].review.$post({
          ...id(r.cardId),
          // The answer's own id: sent again after a lost response, it is not applied twice.
          json: { id: ulid(), face: r.face, rating: r.rating, reps: r.reps },
        }),
      ),
  });
  const undo = useMutation({ onSuccess, mutationFn: () => json(api.cards.undo.$post()) });
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

/** The Notebook (09): the study days and the lessons worked on. */
export const useNotebook = () =>
  useQuery({ queryKey: ["notebook"], queryFn: () => json(api.notebook.$get()) });
export type NotebookOverview = NonNullable<ReturnType<typeof useNotebook>["data"]>;

/** A lesson's passes, newest first. */
export const useNotebookLesson = (lessonKey: string) =>
  useQuery({
    queryKey: ["notebook", "lesson", lessonKey],
    queryFn: () => json(api.notebook.lesson.$get({ query: { lessonKey: lessonKey as LessonKey } })),
  });
export type NotebookPassSummary = NonNullable<
  ReturnType<typeof useNotebookLesson>["data"]
>["passes"][number];

/** One pass in full. */
export const useNotebookPass = (id: string | undefined) =>
  useQuery({
    queryKey: ["notebook", "pass", id],
    enabled: !!id,
    queryFn: () => json(api.notebook.passes[":id"].$get({ param: { id: id as string } })),
  });
export type NotebookPass = NonNullable<ReturnType<typeof useNotebookPass>["data"]>;

/** One item in every pass that answered it. */
export const useItemHistory = (itemKey: string | undefined) =>
  useQuery({
    queryKey: ["notebook", "item", itemKey],
    enabled: !!itemKey,
    queryFn: () => json(api.notebook.item.$get({ query: { itemKey: itemKey as ItemKey } })),
  });

/** Keeps a recording (its bytes as the browser encoded them); its id. A binary body, so not through
 *  the RPC client. */
export async function uploadRecording(take: { blob: Blob; type: string }): Promise<string> {
  return (await sendBinary<{ id: string }>("/api/recordings", take.blob, take.type)).id;
}

/** Where a kept recording plays from. */
export const recordingUrl = (id: string) => `/api/recordings/${id}`;

/** How many recordings are kept and their size. */
export const useRecordingStats = () =>
  useQuery({ queryKey: ["recordings"], queryFn: () => json(api.recordings.$get()) });

export function useDeleteRecordings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => json(api.recordings.$delete()),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recordings"] }),
  });
}

export type SpeechState = Awaited<ReturnType<typeof fetchSpeech>>;
const fetchSpeech = () => json(api.speech.$get());

/** Recognition: the engine, its models (a download's progress polled while it runs), the profile's. */
export const useSpeechState = () =>
  useQuery({
    queryKey: ["speech"],
    queryFn: fetchSpeech,
    refetchInterval: (q) => (q.state.data?.models.some((m) => "downloaded" in m) ? 1000 : false),
  });

export function useSpeechModels() {
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ["speech"] });
  return {
    download: useMutation({
      mutationFn: (id: string) => json(api.speech.models[":id"].$post({ param: { id } })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => json(api.speech.models[":id"].$delete({ param: { id } })),
      onSuccess: done,
    }),
  };
}

/** Piper's voices on the server: the engine (built or not), each voice (a download's progress polled
 *  while it runs). */
export const usePiperVoices = (enabled = true) =>
  useQuery({
    queryKey: ["piper-voices"],
    queryFn: () => json(api.speech.voices.$get()),
    enabled,
    refetchInterval: (q) => (q.state.data?.voices.some((v) => "downloaded" in v) ? 1000 : false),
  });

export function usePiperVoiceActions() {
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ["piper-voices"] });
  return {
    download: useMutation({
      mutationFn: (id: string) => json(api.speech.voices[":id"].$post({ param: { id } })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => json(api.speech.voices[":id"].$delete({ param: { id } })),
      onSuccess: done,
    }),
  };
}

/** Qwen3-TTS on the server: the engine (built or not), its models (a download's progress polled while it
 *  runs), the languages it speaks and its speakers. */
export const useQwenTts = (enabled = true) =>
  useQuery({
    queryKey: ["qwen-tts"],
    queryFn: () => json(api.speech.qwen.$get()),
    enabled,
    refetchInterval: (q) => (q.state.data?.models.some((m) => "downloaded" in m) ? 1000 : false),
  });

export function useQwenModelActions() {
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ["qwen-tts"] });
  return {
    download: useMutation({
      mutationFn: (id: string) => json(api.speech.qwen.models[":id"].$post({ param: { id } })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => json(api.speech.qwen.models[":id"].$delete({ param: { id } })),
      onSuccess: done,
    }),
  };
}

/** Starts Qwen3-TTS ahead of reading (loading its model takes seconds). */
export const warmQwen = () =>
  fetch("/api/speech/qwen/warm", { method: "POST", headers: { ...CLIENT_HEADERS } }).catch(
    () => {},
  );

/** A text said by the server's voice for its language, as a WAV (the profile's voice and speed). */
export async function sayOnServer(
  text: string,
  lang: string,
  options: { voice?: string; signal?: AbortSignal } = {},
): Promise<Blob> {
  const json = { text, lang, ...(options.voice && { voice: options.voice }) };
  const res = await api.speech.say.$post({ json }, { init: { signal: options.signal } });
  if (!res.ok) throw await apiError(res);
  return res.blob();
}

/** What was said in a 16 kHz WAV, in a language given (a binary body, not through the RPC client). */
export async function transcribe(wav: Uint8Array<ArrayBuffer>, lang: string): Promise<string> {
  const url = `/api/speech/transcribe?lang=${encodeURIComponent(lang)}`;
  return (await sendBinary<{ text: string }>(url, wav, "audio/wav")).text;
}

/** Starts the recogniser ahead of a recording. */
export const warmSpeech = () =>
  fetch("/api/speech/warm", { method: "POST", headers: { ...CLIENT_HEADERS } }).catch(() => {});
