// Courses: the installed ones, a course's map, check and lessons, what the providers offer, the space
// they take, a progress reset.
import type { ExamKey, LessonKey } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, json, STATIC } from "./client.ts";
import { downloadReady, uploadFile } from "./files.ts";

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

/** How often the source's answers being heard are asked for again. */
const HEARING_POLL_MS = 1500;

/** The source's answers a lesson's spoken answers are checked by, as heard so far (`heard`, by
 *  media path; `hearing` while the server hears those it lacks — the first time), so it is asked
 *  only for a lesson that has any (`enabled`). */
export const useLessonHeard = (series: string, key: string, enabled: boolean) =>
  useQuery({
    queryKey: ["lesson-heard", series, key],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    // Asked again while the server hears the rest (each item's microphone waits for its own).
    refetchInterval: (query) => (query.state.data?.hearing ? HEARING_POLL_MS : false),
    queryFn: () => json(api.lesson.heard.$get({ query: { series, key: key as LessonKey } })),
  });

const fetchCourseHeard = (series: string, course: string) =>
  json(api.course.heard.$get({ query: { series, course } }));
export type CourseHeardState = Awaited<ReturnType<typeof fetchCourseHeard>>;
/** Whether the server works on a course's answers (or is about to: some left, nothing holding them). */
const hearingGoes = (s: CourseHeardState | undefined) =>
  !!s &&
  (s.job?.state === "queued" ||
    s.job?.state === "running" ||
    s.job?.state === "stopping" ||
    (!s.job && !s.waiting && !s.stopped && s.recordings > s.heard + s.failed + s.missing));

/** The course preparation step hearing the source's answers: how many are ready, its job; asked
 *  again while it works. */
export const useCourseHeard = (series: string, course: string) =>
  useQuery({
    queryKey: ["course-heard", series, course],
    queryFn: () => fetchCourseHeard(series, course),
    // While it waits for a model, slowly: one downloaded in Settings starts it.
    refetchInterval: (q) =>
      hearingGoes(q.state.data) ? 1500 : q.state.data?.waiting === "model" ? 10_000 : false,
  });

/** Starts hearing a course's answers (those that failed tried again) or stops it. */
export function useCourseHeardAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ stop, ...target }: { series: string; course: string; stop?: boolean }) =>
      json(
        stop
          ? api.course.heard.stop.$post({ json: target })
          : api.course.heard.$post({ json: target }),
      ),
    onSuccess: (state, { series, course }) =>
      client.setQueryData(["course-heard", series, course], state),
  });
}

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

// A course moved as a file: its file made ready (an edition's), downloaded once;
// a course file sent and installed.
export type ExportedCourse = InferResponseType<typeof api.courses.export.$post, 200>;
export type ImportedCourse = InferResponseType<typeof api.courses.import.$post, 200>;

/** A course's file made ready on the server: its id, name and size. */
export const prepareCourseExport = (course: { series: string; course: string; edition: string }) =>
  json(api.courses.export.$post({ json: course }));

/** Where a prepared course file is downloaded (once). */
export const courseExportUrl = (id: string) => `/api/courses/export/${id}`;

/** Whether a prepared course file is still there to download (nothing taken). */
export const courseExportReady = (id: string) =>
  downloadReady(courseExportUrl(id), "course_export_gone");

/** A course file sent to the server and installed, its progress heard. */
export const uploadCourse = (file: File, onProgress: (sent: number) => void) =>
  uploadFile<ImportedCourse>("/api/courses/import", file, onProgress);
