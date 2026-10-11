// The Notebook (09): its overview, an exam's and a lesson's standing, a pass, an item's history, a
// review day.
import type { ExamKey, ItemKey, Lang, LessonKey } from "@sprachanker/schema";
import { useQuery } from "@tanstack/react-query";
import { api, json } from "./client.ts";

/** The Notebook (09): the study days, each span's bars (a week from `firstDay`, 0 Sunday … 6
 *  Saturday) and every module's standing. */
export const useNotebook = (firstDay: number) =>
  useQuery({
    queryKey: ["notebook", firstDay],
    queryFn: () => json(api.notebook.$get({ query: { firstDay: String(firstDay) } })),
  });
export type NotebookOverview = NonNullable<ReturnType<typeof useNotebook>["data"]>;

/** An exam in the Notebook: every run handed in, its questions as they stand. */
export const useNotebookExam = (exam: string) =>
  useQuery({
    queryKey: ["notebook", "exam", exam],
    queryFn: () => json(api.notebook.exam.$get({ query: { exam: exam as ExamKey } })),
  });

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

/** A review day in full: its date, its card answers, what it held, the review days before and after
 *  it — a language's deck's alone with `lang`. */
export const useNotebookReviewDay = (id: string, lang?: string) =>
  useQuery({
    queryKey: ["notebook", "review", id, lang],
    queryFn: () =>
      json(
        api.notebook.review[":id"].$get({
          param: { id },
          query: lang ? { lang: lang as Lang } : {},
        }),
      ),
  });
export type NotebookReviewDay = NonNullable<ReturnType<typeof useNotebookReviewDay>["data"]>;

/** One item in every pass that answered it. */
export const useItemHistory = (itemKey: string | undefined) =>
  useQuery({
    queryKey: ["notebook", "item", itemKey],
    enabled: !!itemKey,
    queryFn: () => json(api.notebook.item.$get({ query: { itemKey: itemKey as ItemKey } })),
  });
