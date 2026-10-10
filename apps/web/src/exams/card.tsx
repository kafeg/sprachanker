// An installed exam on "My exams" and "Downloaded" (09, Exams; owner's choice 1A, 2026-10-10): a band
// with the language pair and the last mock exam's points, a ring with how ready the learner is, the
// title and publisher, the last mock exam, and the ways in — a mock exam (continued while one runs) and
// practice; on "My exams" its removal (its runs deleted), on "Downloaded" its course's check and sync.
import { examPassed } from "@sprachanker/engine";
import type { ExamKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Dumbbell, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExamRow } from "@/api/exams.ts";
import { ResetProgress } from "@/courses/reset-progress.tsx";
import { CourseUpkeep } from "@/courses/upkeep.tsx";
import { Button } from "@/ui/components/button.tsx";
import { PairFlags } from "@/ui/flags.tsx";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { ProgressRing } from "@/ui/progress-ring.tsx";
import { examParams } from "./params.ts";

export function ExamCard({
  exam,
  edition,
  removable,
  upkeep,
}: {
  exam: ExamRow;
  edition: string;
  /** In "My exams": the exam can be removed from there (its mock exams and practice deleted). */
  removable?: boolean;
  /** In "Downloaded": its course's check and sync. */
  upkeep?: boolean;
}) {
  const { t } = useTranslation();
  const percent = usePercent();
  const date = useDateFormat("day");
  const title = exam.titles[edition] ?? exam.courseTitles[edition] ?? exam.key;
  const last = exam.last?.result;
  const passed = examPassed(last);
  const params = examParams(exam.key);
  const testRunning = exam.active?.plan.mode === "test" ? exam.active : undefined;
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex min-h-14 items-center gap-3 bg-primary/15 px-4">
        <PairFlags edition={edition} size="md" />
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">
          {last
            ? t("exams.lastPoints", { points: last.points, max: last.max })
            : t("exams.questions", { count: exam.questions })}
        </span>
        {removable && (
          <ResetProgress
            series={exam.series}
            course={exam.course}
            exam={exam.key as ExamKey}
            title={title}
          >
            {(open) => (
              <Button
                variant="ghost"
                size="icon"
                onClick={open}
                aria-label={t("progress.removeExam")}
                title={t("progress.removeExam")}
                className="-mr-2 text-muted-foreground"
              >
                <X className="size-4" />
              </Button>
            )}
          </ResetProgress>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <Link to="/exam/$series/$course/$exam" params={params} className="flex items-center gap-3">
          <ProgressRing
            value={exam.readiness}
            text={percent(exam.readiness)}
            className="size-14 sm:size-16"
          />
          <span className="min-w-0">
            <span className="line-clamp-2 text-xl font-bold leading-tight">{title}</span>
            <span className="block truncate text-sm text-muted-foreground">
              {exam.source?.publisher}
            </span>
          </span>
        </Link>
        {upkeep && <CourseUpkeep series={exam.series} course={exam.course} />}
        <p className="mt-3 text-sm text-muted-foreground">
          {t("exams.ready", { percent: percent(exam.readiness) })}
        </p>
        {exam.last?.finishedAt && passed !== undefined && (
          <p className={`text-sm ${passed ? "text-correct" : "text-wrong"}`}>
            {t(passed ? "exams.lastPassed" : "exams.lastFailed", {
              date: date.format(exam.last.finishedAt),
            })}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          {testRunning ? (
            <Button asChild size="lg" className="flex-1">
              <Link
                to="/exam/$series/$course/$exam/run/$run"
                params={{ ...params, run: testRunning.id }}
              >
                {t("exams.continueTest")} <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="flex-1">
              <Link to="/exam/$series/$course/$exam" params={params} search={{ start: "test" }}>
                {t("exams.mode.test")} <ArrowRight className="size-4" />
              </Link>
            </Button>
          )}
          {/* No practice while a mock exam runs: it is handed in first. */}
          {!testRunning && (
            <Button asChild size="lg" variant="outline">
              <Link to="/exam/$series/$course/$exam" params={params} search={{ start: "practice" }}>
                <Dumbbell className="size-4" /> {t("exams.mode.practice")}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
