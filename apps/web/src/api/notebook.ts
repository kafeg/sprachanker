// The Notebook (09): its overview, an exam's and a lesson's standing, a pass, an item's history, a
// review day.
import type { ExamKey, ItemKey, LessonKey } from "@sprachanker/schema";
import { useQuery } from "@tanstack/react-query";
import { api, json } from "./client.ts";

/** The Notebook (09): the study days and every module's standing. */
export const useNotebook = () =>
  useQuery({ queryKey: ["notebook"], queryFn: () => json(api.notebook.$get()) });
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

/** A review day in full: its card answers, what it held, the review days before and after it. */
export const useNotebookReviewDay = (id: string) =>
  useQuery({
    queryKey: ["notebook", "review", id],
    queryFn: () => json(api.notebook.review[":id"].$get({ param: { id } })),
  });
export type NotebookReviewDay = NonNullable<ReturnType<typeof useNotebookReviewDay>["data"]>;

/** One item in every pass that answered it. */
export const useItemHistory = (itemKey: string | undefined) =>
  useQuery({
    queryKey: ["notebook", "item", itemKey],
    enabled: !!itemKey,
    queryFn: () => json(api.notebook.item.$get({ query: { itemKey: itemKey as ItemKey } })),
  });
