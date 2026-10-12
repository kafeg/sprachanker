// Course downloads: the server's jobs, polled while one runs, starting one, and a course downloaded
// removed from the computer.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, json } from "./client.ts";

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
    for (const key of ["courses", "exams", "catalog"])
      void client.invalidateQueries({ queryKey: [key] });
  }, [phases, client]);
  useEffect(() => {
    if (!ended) return;
    for (const key of ["course", "course-check", "lesson", "storage"])
      void client.invalidateQueries({ queryKey: [key] });
  }, [ended, client]);
}

/** Downloads a course, completes it or syncs it with its source (one idempotent job). */
/** Removes a downloaded course or exam from the computer; every list it was in is read again. */
export function useRemoveCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: { series: string; course: string }) =>
      json(api.course.$delete({ query: target })),
    onSuccess: () => {
      for (const key of ["courses", "exams", "catalog", "course", "course-check", "storage"])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
}

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
