// The head of the course map (09): progress and the way back into the course, where the course comes
// from and on what terms, what it holds (lessons, exercises, words, media) and whether all of it is on
// disk, and syncing it with its source.
import { type CourseSource, parseLessonKey } from "@sprachanker/schema";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourseCheck, useCourseSync, useStartSync } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { PairFlags } from "@/ui/flags.tsx";
import { ResetProgress } from "@/ui/reset-progress.tsx";
import { cn } from "@/ui/utils.ts";

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

const size = (bytes: number, locale: string) => {
  const giga = bytes >= 1e9;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: giga ? "gigabyte" : "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / (giga ? 1e9 : 1e6));
};

/** Media tiles in this order; kinds not listed come last. */
const KINDS = ["video", "audio", "image", "subtitles", "pdf"];
const kindRank = (kind: string) => {
  const i = KINDS.indexOf(kind);
  return i < 0 ? KINDS.length : i;
};

const chip = "inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs";

/** Share of lessons done, 0..1, as a ring with the percentage inside. */
function ProgressRing({ value }: { value: number }) {
  const { i18n } = useTranslation();
  const text = new Intl.NumberFormat(i18n.language, { style: "percent" }).format(value);
  const r = 30;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 76 76" className="size-16 shrink-0 sm:size-20" role="img" aria-label={text}>
      <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" className="stroke-primary/20" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${value * length} ${length}`}
        transform="rotate(-90 38 38)"
        className="stroke-primary"
      />
      <text x="38" y="43" textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
        {text}
      </text>
    </svg>
  );
}

function Tile({
  value,
  label,
  missing,
}: {
  value: string | number;
  label: string;
  missing?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border px-3 py-2">
      <div className="whitespace-nowrap text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {!!missing && (
        <div className="text-xs text-wrong">{t("course.missing", { count: missing })}</div>
      )}
    </div>
  );
}

export type CourseHeroProps = {
  series: string;
  course: string;
  title: string;
  edition: string;
  descriptionHtml?: string;
  source: CourseSource | null;
  done: number;
  lessons: number;
  /** The lesson to go on with, its title, and whether it was started. */
  next?: { key: string; title: string; started: boolean };
};

export function CourseHero(props: CourseHeroProps) {
  const { series, course, title, edition, descriptionHtml, source, done, lessons, next } = props;
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const check = useCourseCheck(series, course, true);
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
    void client.invalidateQueries({ queryKey: ["lesson", series] });
    void client.invalidateQueries({ queryKey: ["courses"] });
  }, [finishedAt, client, series, course]);
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  const r = check.data;
  const exercises = r ? Object.values(r.exercises).reduce((a, b) => a + b, 0) : 0;
  const share = done / Math.max(1, lessons);
  const nextKey = next && parseLessonKey(next.key);

  return (
    <section className="mb-8 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex min-w-0 flex-1 basis-80 items-center gap-4 sm:gap-5">
          <ProgressRing value={share} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold sm:text-4xl">{title}</h1>
            <div className="my-2 flex flex-wrap gap-1.5">
              <span className={chip}>
                <PairFlags edition={edition} />
              </span>
              {source && (
                <>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(chip, "hover:bg-accent")}
                  >
                    {source.publisher} <ExternalLink className="size-3" />
                  </a>
                  <span className={chip}>{t(`course.licence.${source.licence}`)}</span>
                </>
              )}
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className={cn(
                  chip,
                  "hover:bg-accent",
                  r && !r.problems.length && "border-correct/50 text-correct",
                  r?.problems.length && "border-wrong/50 text-wrong",
                )}
              >
                {!r ? (
                  <>
                    <LoaderCircle className="size-3 animate-spin" /> {t("course.checking")}
                  </>
                ) : r.problems.length ? (
                  <>
                    <CircleX className="size-3" />{" "}
                    {t("course.problems", { count: r.problems.length })}
                  </>
                ) : (
                  <>
                    <CircleCheck className="size-3" /> {t("course.complete")}
                  </>
                )}
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("courses.progress", { done, total: lessons })}
              {next && nextKey && (
                <>
                  {" "}
                  ·{" "}
                  {t("course.next", { where: t("lesson.unitLesson", nextKey), title: next.title })}
                </>
              )}
            </p>
          </div>
        </div>
        {next && nextKey && (
          <Link
            to="/lesson/$series/$course/$lesson"
            params={{ series, course, lesson: nextKey.name }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {next.started || done > 0 ? t("lesson.resume") : t("courses.start")}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      {r && (
        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
          <Tile value={r.lessons} label={t("course.stats.lessons", { count: r.lessons })} />
          <Tile value={exercises} label={t("course.stats.exercises", { count: exercises })} />
          <Tile value={r.vocab} label={t("course.stats.words", { count: r.vocab })} />
          {Object.entries(r.media.byKind)
            .sort(([a], [b]) => kindRank(a) - kindRank(b))
            .map(([kind, n]) => (
              <Tile
                key={kind}
                value={n.present}
                label={t(`course.stats.${kind}`, { count: n.present, defaultValue: kind })}
                missing={n.missing}
              />
            ))}
          <Tile value={size(r.media.bytes, i18n.language)} label={t("course.stats.size")} />
        </div>
      )}

      {/* What can be done with the course itself: sync it with its source, reset its progress. */}
      {(sync.data?.available || done > 0 || next?.started) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sync.data?.available && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent"
            >
              <RefreshCw className={cn("size-4", running && "animate-spin")} />
              {running ? t("course.syncing") : t("course.sync")}
            </button>
          )}
          {(done > 0 || next?.started) && (
            <ResetProgress series={series} course={course} title={title}>
              {(open) => (
                <button
                  type="button"
                  onClick={open}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent hover:text-wrong"
                >
                  <RotateCcw className="size-4" /> {t("progress.resetCourse")}
                </button>
              )}
            </ResetProgress>
          )}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3 rounded-xl bg-muted/60 p-4 text-sm">
          {r && (
            <p className="flex items-center gap-1.5">
              {r.problems.length ? (
                <CircleX className="size-4 text-wrong" />
              ) : (
                <CircleCheck className="size-4 text-correct" />
              )}
              {r.problems.length
                ? t("course.problems", { count: r.problems.length })
                : t("course.intact")}
            </p>
          )}
          {!!r?.problems.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {r.problems.slice(0, 10).map((p) => (
                <li key={p} className="break-all">
                  {p}
                </li>
              ))}
            </ul>
          )}
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
                {running ? t("course.syncing") : t("course.syncStart")}
              </Button>
            )}
          </div>
          {sync.data?.available && <p className="text-muted-foreground">{t("course.syncHint")}</p>}
          {job && (
            <div className="space-y-1">
              <p className="font-medium">
                {job.status === "running"
                  ? t("course.syncRunning")
                  : job.status === "done"
                    ? t("course.syncDone", { failed: job.report?.failedMedia.length ?? 0 })
                    : t("course.syncFailed", { error: job.error ?? "" })}
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-background p-2 text-xs leading-relaxed">
                {job.log.slice(-15).join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}

      {descriptionHtml && (
        <CourseHtml
          className="mt-5 border-t pt-4 text-sm text-muted-foreground"
          html={descriptionHtml}
        />
      )}
    </section>
  );
}
