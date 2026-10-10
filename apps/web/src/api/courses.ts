// Courses: the installed ones, a course's map, check and lessons, what the providers offer, the space
// they take, a progress reset.
import type { ExamKey, LessonKey } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json, STATIC } from "./client.ts";

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

/** A course's check (files on disk, consistent); `enabled` false until asked for (a check found
 *  before shows all the same). */
export const useCourseCheck = (series: string, course: string, enabled = true) =>
  useQuery({
    queryKey: ["course-check", series, course],
    meta: STATIC,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => json(api.course.check.$get({ query: { series, course } })),
  });

/** Every course the providers offer, with its state (available, downloading, incomplete, ready). */
export const useCatalog = () =>
  useQuery({ queryKey: ["catalog"], meta: STATIC, queryFn: () => json(api.catalog.$get()) });
export type CatalogRow = NonNullable<ReturnType<typeof useCatalog>["data"]>[number];

/** The data folder and the space each series takes. */
export const useStorage = () =>
  useQuery({ queryKey: ["storage"], queryFn: () => json(api.storage.$get()) });

/** Resets the progress of a course, or of one of its lessons (the screens confirm first). */
export function useResetProgress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: { series: string; course: string; lesson?: LessonKey; exam?: ExamKey }) =>
      json(api.progress.reset.$post({ json: target })),
    // Progress shows in many places (course list and map, tutor, reviews): read it all again — not
    // the course content and its file check, which a reset does not change.
    onSuccess: () => void client.invalidateQueries({ predicate: (q) => q.meta?.static !== true }),
  });
}
