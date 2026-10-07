// TanStack Query hooks over the API.
import type { CardFace, CardRating, LessonKey } from "@sprachanker/schema";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ulid } from "ulid";
import { api, json } from "./client.ts";

/** The server's version (and that it answers). */
export const useAppInfo = () =>
  useQuery({
    queryKey: ["health"],
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

export function useSetSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      json(api.settings.$put({ json: { key, value } })),
    // Applied at once, so a screen opened right after (e.g. a course in the chosen edition) sees it.
    onMutate: ({ key, value }) =>
      client.setQueryData(["settings"], (old: Settings | undefined) => ({ ...old, [key]: value })),
    onSuccess: (settings) => client.setQueryData(["settings"], settings),
  });
}

/** A course's integrity and counts (verify): read on demand — it reads every file of the course. */
export const useCourseCheck = (series: string, course: string, enabled: boolean) =>
  useQuery({
    queryKey: ["course-check", series, course],
    enabled,
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
  useQuery({ queryKey: ["catalog"], queryFn: () => json(api.catalog.$get()) });

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
    // Progress shows in many places (course list and map, tutor, reviews): read everything again.
    onSuccess: () => void client.invalidateQueries(),
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

/** The decks and the queue read again after cards change; resolves once they are. */
const readCardsAgain = (client: QueryClient) =>
  Promise.all(["study", "decks"].map((key) => client.invalidateQueries({ queryKey: [key] })));

/** Decks: each language, and under it each course, with Anki's three counts. */
export const useDecks = () =>
  useQuery({ queryKey: ["decks"], queryFn: () => json(api.cards.decks.$get()) });

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
    mutationFn: (r: { cardId: string; face?: CardFace }) =>
      json(
        api.cards[":id"].suspend.$put({ ...id(r.cardId), json: { suspended: true, face: r.face } }),
      ),
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
