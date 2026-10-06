// TanStack Query hooks over the API.
import type { LessonKey } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** The course's sync job; polled while it runs. */
export const useCourseSync = (series: string, course: string) =>
  useQuery({
    queryKey: ["course-sync", series, course],
    queryFn: () => json(api.course.sync.$get({ query: { series, course } })),
    refetchInterval: (q) => (q.state.data?.job?.status === "running" ? 1500 : false),
  });

export function useStartSync(series: string, course: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => json(api.course.sync.$post({ json: { series, course } })),
    onSuccess: (state) => client.setQueryData(["course-sync", series, course], state),
  });
}

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
