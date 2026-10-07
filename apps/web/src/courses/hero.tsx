// The head of the course map (09): progress and the way back into the course, where the course comes
// from and on what terms, what it holds (lessons, exercises, words, media) and whether all of it is on
// disk, and syncing it with its source.
import { type CourseSource, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourseCheck, useCourseDownload, useStartDownload } from "@/api/hooks.ts";
import { ResetProgress } from "@/app/reset-progress.tsx";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { PairFlags } from "@/ui/flags.tsx";
import { useBytes, usePercent } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";
import { DownloadLine, downloading } from "./download.tsx";

/** Media tiles in this order; kinds not listed come last. */
const KINDS = ["video", "audio", "image", "subtitles", "pdf"];
const kindRank = (kind: string) => {
  const i = KINDS.indexOf(kind);
  return i < 0 ? KINDS.length : i;
};

const chip = "inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs";

/** Share of lessons done, 0..1, as a ring with the percentage inside. */
function ProgressRing({ value }: { value: number }) {
  const text = usePercent()(value);
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
  /** The lesson to go on with and its title. */
  next?: { key: string; title: string };
  /** The course is begun (engine `courseProgress`). */
  started: boolean;
};

export function CourseHero(props: CourseHeroProps) {
  const { series, course, title, edition, descriptionHtml, source, done, lessons, next, started } =
    props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const check = useCourseCheck(series, course);
  const bytes = useBytes();
  const { available, job } = useCourseDownload(series, course);
  const start = useStartDownload();
  const running = downloading(job);
  // Files missing (media that failed or have not come yet): the download can go on.
  const missing = check.data?.media.missing ?? 0;

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
            {started ? t("lesson.resume") : t("courses.start")}
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
          <Tile value={bytes(r.media.bytes)} label={t("course.stats.size")} />
        </div>
      )}

      {job && running && <DownloadLine job={job} className="mt-4" />}

      {/* What can be done with the course itself: download what is missing or sync it with its
          source, reset its progress. */}
      {(available || started) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {available && !running && (
            <button
              type="button"
              onClick={() => start.mutate({ series, course })}
              disabled={start.isPending}
              className={cn(
                "flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm",
                missing
                  ? "border-primary bg-primary/15 font-medium"
                  : "border-dashed text-muted-foreground hover:bg-accent",
              )}
            >
              {missing ? <Download className="size-4" /> : <RefreshCw className="size-4" />}
              {missing ? t("download.continue") : t("download.sync")}
            </button>
          )}
          {started && (
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
          </div>
          {available && <p className="text-muted-foreground">{t("download.hint")}</p>}
          {job && (
            <div className="space-y-1">
              {(job.status === "done" || job.status === "failed") && (
                <p className="font-medium">
                  {job.status === "done"
                    ? t("download.done", { failed: job.report?.failedMedia.length ?? 0 })
                    : t("download.failed", { error: job.error ?? "" })}
                </p>
              )}
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  {t("download.log")}
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-background p-2 text-xs leading-relaxed">
                  {job.log.slice(-15).join("\n")}
                </pre>
              </details>
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
