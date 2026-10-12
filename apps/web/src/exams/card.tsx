// An installed exam on "My exams" and "Downloaded" (09, Exams; owner's choice 1A, 2026-10-10), on the
// library's card: a band with the language pair and the last mock exam's points, a ring with how ready
// the learner is, the title and publisher, the last mock exam, and the ways in — a mock exam (continued
// while one runs) and practice; on "My exams" its removal (its runs deleted), on "Downloaded" its
// course's check, sync and export to a file.
import { examPassed, examScore } from "@sprachanker/engine";
import type { ExamKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Dumbbell } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExamRow } from "@/api/exams.ts";
import { CourseExport } from "@/library/bundle.tsx";
import { LibraryCard } from "@/library/card.tsx";
import { examParams } from "@/library/exam-address.ts";
import { CourseRemove, CourseUpkeep } from "@/library/upkeep.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { ProgressRing } from "@/ui/progress-ring.tsx";

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
  /** In "Downloaded": its course's check, sync and export to a file. */
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
    <LibraryCard
      series={exam.series}
      course={exam.course}
      edition={edition}
      figure={
        last
          ? t("exams.lastPoints", examScore(last, "test"))
          : t("exams.questions", { count: exam.questions })
      }
      remove={
        removable
          ? { title, label: t("progress.removeExam"), exam: exam.key as ExamKey }
          : undefined
      }
    >
      <Link to="/exam/$series/$course/$exam" params={params} className="flex items-center gap-3">
        <ProgressRing
          value={exam.readiness}
          text={percent(exam.readiness)}
          className="size-14 sm:size-16"
        />
        {/* Titles and publishers wrap, whole (an exam's title runs to three lines beside the ring);
            only a longer one is cut, shown whole on hover. */}
        <span className="min-w-0">
          <span dir="auto" className="line-clamp-4 text-xl font-bold leading-tight" title={title}>
            {title}
          </span>
          <span
            className="line-clamp-2 text-sm text-muted-foreground"
            title={exam.source?.publisher}
          >
            {exam.source?.publisher}
          </span>
        </span>
      </Link>
      {upkeep && (
        <CourseUpkeep series={exam.series} course={exam.course}>
          <CourseExport series={exam.series} course={exam.course} edition={edition} exam />
          <CourseRemove series={exam.series} course={exam.course} title={title} exam />
        </CourseUpkeep>
      )}
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
              {t("exams.continueTest")} <ArrowRight className="rtl:-scale-x-100 size-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg" className="flex-1">
            <Link to="/exam/$series/$course/$exam" params={params} search={{ start: "test" }}>
              {t("exams.mode.test")} <ArrowRight className="rtl:-scale-x-100 size-4" />
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
    </LibraryCard>
  );
}
