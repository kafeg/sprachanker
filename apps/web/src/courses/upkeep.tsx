// Keeping a downloaded course whole (09): its check — every file on disk and consistent — and syncing
// it with its source. The course page's head and the Downloaded cards show them the same way.
import { CircleCheck, CircleX, Download, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalog, useCourseCheck, useCourseDownload, useStartDownload } from "@/api/hooks.ts";
import { cn } from "@/ui/utils.ts";
import { downloading } from "./download.tsx";

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

/** The first problems the check found. */
export function ProblemList({ problems, max }: { problems: string[]; max: number }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
      {problems.slice(0, max).map((p) => (
        <li key={p} className="break-all">
          {p}
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
    <button
      type="button"
      onClick={() => start.mutate({ series, course })}
      disabled={start.isPending}
      title={t("download.sync")}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border px-3 text-sm",
        short ? "min-h-9 pointer-coarse:min-h-11" : "min-h-11",
        attention
          ? "border-primary bg-primary/15 font-medium"
          : "border-dashed text-muted-foreground hover:bg-accent",
      )}
    >
      {missing ? <Download className="size-4" /> : <RefreshCw className="size-4" />}
      {missing ? t("download.continue") : short ? t("download.syncShort") : t("download.sync")}
    </button>
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
          <button
            type="button"
            onClick={() => setAsked(true)}
            className="flex min-h-9 items-center gap-1.5 rounded-xl border border-dashed px-3 text-muted-foreground hover:bg-accent pointer-coarse:min-h-11"
          >
            <ShieldCheck className="size-4" /> {t("course.checkFiles")}
          </button>
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
