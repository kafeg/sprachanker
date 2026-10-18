// A course's preparation (owner, 2026-10-18): what is made into the course once it is installed, so
// its lessons rely on it without waiting — the source's answers heard (every course whose items have
// recorded answers), and the steps optional features add (the AI assistant's practice) —, in one place
// on the course page: what is ready and what is missing, each step run and stopped. Opened by its
// button among the course's actions, which says meanwhile how far the hearing is; a Downloaded card
// shows the hearing's line while it works.
import { ListChecks } from "lucide-react";
import { type ComponentType, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { type CourseHeardState, useCourseHeard, useCourseHeardAction } from "@/api/courses.ts";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { JobRow } from "@/ui/job-row.tsx";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { quietButton } from "./upkeep.tsx";

type CourseIds = { series: string; course: string; edition: string };
/** A step an optional feature adds to the course's preparation: its progress in a few words while
 *  it is made (none: nothing), its section in the panel. */
export type CoursePrepStep = {
  Running: ComponentType<CourseIds>;
  Section: ComponentType<CourseIds>;
};

const working = (s: CourseHeardState | undefined) =>
  s?.job?.state === "running" || s?.job?.state === "stopping";

/** The button among the course's actions that opens its preparation; none when the course has no
 *  answers to hear and no feature adds a step. */
export function CoursePrepButton({
  steps = [],
  open,
  onToggle,
  ...ids
}: CourseIds & { steps?: CoursePrepStep[]; open: boolean; onToggle(): void }) {
  const { t } = useTranslation();
  const heard = useCourseHeard(ids.series, ids.course).data;
  if (!heard?.recordings && !steps.length) return null;
  return (
    <Button
      variant="outline"
      aria-expanded={open}
      aria-controls="course-prep"
      onClick={onToggle}
      className={cn(quietButton, "h-11", open && "border-solid text-foreground")}
    >
      <ListChecks />
      {t("prep.title")}
      {heard && working(heard) && (
        <span className="text-muted-foreground tabular-nums">
          · {t("prep.heard.short", { heard: heard.heard, total: heard.recordings })}
        </span>
      )}
      {steps.map(({ Running }, i) => (
        <Suspense key={String(i)} fallback={null}>
          <Running {...ids} />
        </Suspense>
      ))}
    </Button>
  );
}

/** The course's preparation under its head: every step, what it has made and what is missing. */
export function CoursePrep({ steps = [], ...ids }: CourseIds & { steps?: CoursePrepStep[] }) {
  const { t } = useTranslation();
  return (
    <Panel id="course-prep" className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{t("prep.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("prep.intro")}</p>
      </div>
      <HeardSection series={ids.series} course={ids.course} />
      {steps.map(({ Section }, i) => (
        <Suspense key={String(i)} fallback={null}>
          <Section {...ids} />
        </Suspense>
      ))}
    </Panel>
  );
}

/** The source's answers heard: how many are ready, the job, what holds it (a model, a stop), what
 *  failed or is not downloaded. None when the course has no recorded answers. */
function HeardSection({ series, course }: { series: string; course: string }) {
  const { t } = useTranslation();
  const state = useCourseHeard(series, course).data;
  if (!state?.recordings) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-semibold">{t("prep.heard.title")}</h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("prep.heard.ready", { heard: state.heard, total: state.recordings })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t("prep.heard.what")}</p>
      <HeardLine series={series} course={course} state={state} />
    </section>
  );
}

/** The hearing's progress and Stop while it works, else what holds it and its action. */
export function HeardLine({
  series,
  course,
  state: given,
  compact = false,
}: {
  series: string;
  course: string;
  state?: CourseHeardState;
  /** A card's: only while it works or waits. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const asked = useCourseHeard(series, course).data;
  const action = useCourseHeardAction();
  const state = given ?? asked;
  if (!state?.recordings) return null;
  const { job } = state;
  const left = state.recordings - state.heard - state.missing;
  const run = (stop?: boolean) => action.mutate({ series, course, stop });
  if (compact && !working(state) && !state.waiting && job?.state !== "queued") return null;
  const idle =
    job?.state === "queued" ? (
      <p className="text-muted-foreground">{t("prep.heard.queued")}</p>
    ) : state.waiting ? (
      <p className="text-muted-foreground">
        {state.waiting === "engine" ? t("error.speech_unavailable") : t("prep.heard.waiting")}
      </p>
    ) : compact ? null : state.stopped && left > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t("prep.heard.stopped")}</span>
        <Button variant="outline" size="sm" loading={action.isPending} onClick={() => run()}>
          {t("prep.heard.continue")}
        </Button>
      </div>
    ) : left > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {state.failed > 0 && (
          <span className="text-wrong">{t("prep.heard.failed", { count: state.failed })}</span>
        )}
        <Button variant="outline" size="sm" loading={action.isPending} onClick={() => run()}>
          {state.failed > 0 ? t("prep.heard.retry") : t("prep.heard.start")}
        </Button>
      </div>
    ) : null;
  return (
    <>
      <JobRow
        className={compact ? "mt-2" : undefined}
        running={
          job && working(state)
            ? {
                status: t("prep.heard.running", { done: job.done, total: job.total }),
                done: job.done,
                total: job.total,
                stopping: job.state === "stopping",
                stop: t("prep.stop"),
                onStop: () => run(true),
              }
            : undefined
        }
        idle={idle}
        error={
          (action.error && errorText(t, action.error)) ||
          (job?.error && !working(state) ? errorText(t, job.error) : undefined)
        }
      />
      {!compact && state.missing > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("prep.heard.missing", { count: state.missing })}
        </p>
      )}
    </>
  );
}
