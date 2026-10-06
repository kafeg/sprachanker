// TanStack Query hooks over the API.
import type { LessonKey } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
