// The head of the course map (09): progress and the way back into the course, where the course comes
// from and on what terms, what it holds (lessons, exercises, words, media) and whether all of it is on
// disk, and syncing it with its source.
import { type CourseSource, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, CircleX, ExternalLink, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourseCheck } from "@/api/courses.ts";
import { useCourseDownload } from "@/api/downloads.ts";
import { DownloadLine, downloading } from "@/library/download.tsx";
import { LibraryHero } from "@/library/hero.tsx";
import { ResetProgress } from "@/library/reset-progress.tsx";
import {
  CheckState,
  checkTone,
  chip,
  needsSync,
  ProblemList,
  quietButton,
  SyncButton,
} from "@/library/upkeep.tsx";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { PairFlags } from "@/ui/flags.tsx";
import { useBytes } from "@/ui/format.ts";
import { StatTile } from "@/ui/stat-tile.tsx";
import { cn } from "@/ui/utils.ts";

/** Media tiles in this order; kinds not listed come last. */
const KINDS = ["video", "audio", "image", "subtitles", "pdf"];
const kindRank = (kind: string) => {
  const i = KINDS.indexOf(kind);
  return i < 0 ? KINDS.length : i;
};

type CourseHeroProps = {
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
  const running = downloading(job);

  const r = check.data;
  const exercises = r ? Object.values(r.exercises).reduce((a, b) => a + b, 0) : 0;
  const share = done / Math.max(1, lessons);
  const nextKey = next && parseLessonKey(next.key);

  return (
    <LibraryHero
      share={share}
      title={title}
      chips={
        <>
          <span className={chip}>
            <PairFlags edition={edition} />
          </span>
          {source && (
            <>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className={cn(chip, "hover:bg-accent pointer-coarse:min-h-11")}
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
            className={cn(chip, "hover:bg-accent pointer-coarse:min-h-11", checkTone(r))}
          >
            <CheckState check={check} />
          </button>
        </>
      }
      line={
        <>
          {t("courses.progress", { done, total: lessons })}
          {next && nextKey && (
            <>
              {" "}
              · {t("course.next", { where: t("lesson.unitLesson", nextKey), title: next.title })}
            </>
          )}
        </>
      }
      action={
        next &&
        nextKey && (
          <Button asChild size="lg">
            <Link
              to="/lesson/$series/$course/$lesson"
              params={{ series, course, lesson: nextKey.name }}
            >
              {started ? t("lesson.resume") : t("courses.start")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        )
      }
    >
      {r && (
        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
          <StatTile
            size="sm"
            value={r.lessons}
            label={t("course.stats.lessons", { count: r.lessons })}
          />
          <StatTile
            size="sm"
            value={exercises}
            label={t("course.stats.exercises", { count: exercises })}
          />
          <StatTile size="sm" value={r.vocab} label={t("course.stats.words", { count: r.vocab })} />
          {Object.entries(r.media.byKind)
            .sort(([a], [b]) => kindRank(a) - kindRank(b))
            .map(([kind, n]) => (
              <StatTile
                size="sm"
                key={kind}
                value={n.present}
                label={t(`course.stats.${kind}`, { count: n.present, defaultValue: kind })}
                alert={n.missing ? t("course.missing", { count: n.missing }) : undefined}
              />
            ))}
          <StatTile size="sm" value={bytes(r.media.bytes)} label={t("course.stats.size")} />
        </div>
      )}

      {job && running && <DownloadLine job={job} className="mt-4" />}

      {/* What can be done with the course itself: download what is missing or sync it with its
          source, reset its progress. */}
      {(available || started) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <SyncButton
            series={series}
            course={course}
            attention={needsSync(r)}
            missing={(r?.media.missing ?? 0) > 0}
          />
          {started && (
            <ResetProgress series={series} course={course} title={title}>
              {(open) => (
                <Button
                  variant="outline"
                  onClick={open}
                  className={cn(quietButton, "h-11 hover:text-wrong")}
                >
                  <RotateCcw /> {t("progress.resetCourse")}
                </Button>
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
          {!!r?.problems.length && <ProblemList problems={r.problems} max={10} />}
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
                <summary className="cursor-pointer text-muted-foreground pointer-coarse:min-h-11 pointer-coarse:content-center">
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
    </LibraryHero>
  );
}
