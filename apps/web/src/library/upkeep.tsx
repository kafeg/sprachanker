// Keeping a downloaded course whole (09): its check — every file on disk and consistent — and syncing
// it with its source. The course page's head and the Downloaded cards show them the same way.
import { CircleCheck, CircleX, Download, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalog, useCourseCheck } from "@/api/courses.ts";
import { useCourseDownload, useStartDownload } from "@/api/downloads.ts";
import { Button } from "@/ui/components/button.tsx";
import { cn } from "@/ui/utils.ts";
import { downloading } from "./download.tsx";

// The course's own actions (check, sync, reset) as quiet dashed buttons; the sync marked when the
// check finds something to mend.
const upkeepButton = "rounded-xl px-3 shadow-none";
const quiet = "border-dashed bg-transparent font-normal text-muted-foreground dark:bg-transparent";
export const quietButton = cn(upkeepButton, quiet);

export const chip = "inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs";

type Check = ReturnType<typeof useCourseCheck>;
type Report = NonNullable<Check["data"]>;

/** Whether the check found something a sync may mend: files missing or problems. */
export const needsSync = (r: Report | undefined) =>
  !!r && (r.media.missing > 0 || r.problems.length > 0);

/** The chip's colour for what the check found: whole, or problems. */
export const checkTone = (r: Report | undefined) =>
  cn(
    r && !r.problems.length && "border-correct/50 text-correct",
    r?.problems.length && "border-wrong/50 text-wrong",
  );

/** What the check found, as a chip's content: checking, problems, or whole. */
export function CheckState({ check }: { check: Check }) {
  const { t } = useTranslation();
  const r = check.data;
  if (!r || check.isFetching)
    return (
      <>
        <LoaderCircle className="size-3 animate-spin" /> {t("course.checking")}
      </>
    );
  return r.problems.length ? (
    <>
      <CircleX className="size-3" /> {t("course.problems", { count: r.problems.length })}
    </>
  ) : (
    <>
      <CircleCheck className="size-3" /> {t("course.complete")}
    </>
  );
}

/** The first problems the check found, in the interface's language (the finding in full on hover). */
export function ProblemList({ problems, max }: { problems: Report["problems"]; max: number }) {
  const { t } = useTranslation();
  return (
    <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
      {problems.slice(0, max).map((p) => (
        <li key={p.text} title={p.text} className="break-all">
          {t(`course.problem.${p.kind}`, { at: p.at })}
        </li>
      ))}
    </ul>
  );
}

/** Downloads what is missing or syncs the course with its source; marked when the check found
 *  something to mend. None while a download runs or when the source offers the course no more. */
export function SyncButton({
  series,
  course,
  attention,
  missing,
  short = false,
}: {
  series: string;
  course: string;
  attention: boolean;
  /** Files are missing: the download goes on rather than syncs. */
  missing: boolean;
  /** The card's shorter label. */
  short?: boolean;
}) {
  const { t } = useTranslation();
  const { available, job } = useCourseDownload(series, course);
  const start = useStartDownload();
  if (!available || downloading(job)) return null;
  return (
    <Button
      variant="outline"
      onClick={() => start.mutate({ series, course })}
      loading={start.isPending}
      title={t("download.sync")}
      className={cn(
        upkeepButton,
        !short && "h-11",
        attention
          ? "border-primary bg-primary/15 hover:bg-primary/25 dark:border-primary dark:bg-primary/15 dark:hover:bg-primary/25"
          : quiet,
      )}
    >
      {!start.isPending && (missing ? <Download /> : <RefreshCw />)}
      {missing ? t("download.continue") : short ? t("download.syncShort") : t("download.sync")}
    </Button>
  );
}

/** A Downloaded card's upkeep: "Check" (its result after, problems listed on a tap) and the sync,
 *  marked when the check found something to mend. A check made on the course page shows here too. */
export function CourseUpkeep({ series, course }: { series: string; course: string }) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  const check = useCourseCheck(series, course, asked);
  const entry = useCatalog().data?.find((e) => e.series === series && e.course === course);
  const r = check.data;
  const problems = r?.problems.length ?? 0;
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {r || check.isFetching ? (
          <button
            type="button"
            onClick={() => (problems ? setOpen((o) => !o) : void check.refetch())}
            aria-expanded={problems ? open : undefined}
            title={problems ? undefined : t("course.checkAgain")}
            className={cn(chip, "min-h-9 pointer-coarse:min-h-11 hover:bg-accent", checkTone(r))}
          >
            <CheckState check={check} />
          </button>
        ) : (
          <Button variant="outline" onClick={() => setAsked(true)} className={quietButton}>
            <ShieldCheck /> {t("course.checkFiles")}
          </Button>
        )}
        {/* Files known missing: the card's banner offers to go on with the download. */}
        {entry?.state !== "incomplete" && (
          <SyncButton
            series={series}
            course={course}
            attention={needsSync(r)}
            missing={(r?.media.missing ?? 0) > 0}
            short
          />
        )}
      </div>
      {open && r && problems > 0 && <ProblemList problems={r.problems} max={5} />}
    </div>
  );
}
