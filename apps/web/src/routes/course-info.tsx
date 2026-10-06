// "About the course" on the course map (09): where it comes from and on what terms, what it holds
// (lessons, exercises, media) and whether all of it is on disk, and syncing it with its source.
import type { CourseSource } from "@sprachanker/schema";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourseCheck, useCourseSync, useStartSync } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";

/** "Deutsche Welle · learngerman.dw.com · free access" with a link to the source. */
export function SourceLine({ source }: { source: CourseSource }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {source.publisher} ·{" "}
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
      >
        {new URL(source.url).host}
        <ExternalLink className="size-3" />
      </a>
      · {t(`course.licence.${source.licence}`)}
    </span>
  );
}

const size = (bytes: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "unit",
    unit: bytes > 2 ** 30 ? "gigabyte" : "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / (bytes > 2 ** 30 ? 2 ** 30 : 2 ** 20));

export function CourseInfo({
  series,
  course,
  source,
}: {
  series: string;
  course: string;
  source: CourseSource | null;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const check = useCourseCheck(series, course, open);
  const sync = useCourseSync(series, course);
  const start = useStartSync(series, course);
  const client = useQueryClient();
  const job = sync.data?.job;
  const running = job?.status === "running";
  // A finished sync changed the course: check it and reload its lessons and the course list.
  const finishedAt = job?.finishedAt;
  useEffect(() => {
    if (!finishedAt) return;
    void client.invalidateQueries({ queryKey: ["course-check", series, course] });
    void client.invalidateQueries({ queryKey: ["course", series, course] });
    void client.invalidateQueries({ queryKey: ["courses"] });
  }, [finishedAt, client, series, course]);

  const r = check.data;
  const exercises = r ? Object.values(r.exercises).reduce((a, b) => a + b, 0) : 0;
  return (
    <details
      className="mb-6 rounded-2xl border bg-card p-4 sm:p-5"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">{t("course.about")}</summary>
      <div className="mt-3 space-y-4 text-sm">
        {source && (
          <p>
            <span className="text-muted-foreground">{t("course.source")}: </span>
            <SourceLine source={source} />
          </p>
        )}
        {check.isPending && open ? (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> {t("course.checking")}
          </p>
        ) : r ? (
          <div className="space-y-2">
            <p>
              {t("course.counts", {
                units: r.units,
                lessons: r.lessons,
                exercises,
                items: r.items,
                words: r.vocab,
              })}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(r.media.byKind).map(([kind, n]) => (
                <li key={kind}>
                  {t(`course.media.${kind}`, { defaultValue: kind })}: {n.present}
                  {n.missing > 0 && (
                    <span className="text-wrong">
                      {" "}
                      ({t("course.missing", { count: n.missing })})
                    </span>
                  )}
                </li>
              ))}
              <li className="text-muted-foreground">{size(r.media.bytes, i18n.language)}</li>
            </ul>
            <p className="flex items-center gap-1.5">
              {r.problems.length ? (
                <>
                  <CircleX className="size-4 text-wrong" />
                  {t("course.problems", { count: r.problems.length })}
                </>
              ) : (
                <>
                  <CircleCheck className="size-4 text-correct" /> {t("course.intact")}
                </>
              )}
            </p>
            {r.problems.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {r.problems.slice(0, 10).map((p) => (
                  <li key={p} className="break-all">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void check.refetch()}
            disabled={check.isFetching}
          >
            {t("course.checkAgain")}
          </Button>
          {sync.data?.available && (
            <Button onClick={() => start.mutate()} disabled={running || start.isPending}>
              {running ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {running ? t("course.syncing") : t("course.sync")}
            </Button>
          )}
        </div>
        <p className="text-muted-foreground">{t("course.syncHint")}</p>
        {job && (
          <div className="space-y-1">
            <p className="font-medium">
              {job.status === "running"
                ? t("course.syncRunning")
                : job.status === "done"
                  ? t("course.syncDone", { failed: job.report?.failedMedia.length ?? 0 })
                  : t("course.syncFailed", { error: job.error ?? "" })}
            </p>
            <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs leading-relaxed">
              {job.log.slice(-15).join("\n")}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
