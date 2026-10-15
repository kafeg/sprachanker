// A course's AI practice on its page (owner, 2026-10-14): how much of each step its lessons have —
// made once, kept with the course, taken by the lessons without a model and carried to other devices
// with it —, and making more for every lesson in one go: the steps, how many of each (1–3), the job's
// progress and Stop. Making needs an AI model; Listening, Qwen3-TTS to record it. Folded under its
// title (owner, 2026-10-15): closed, one line — how much is made, or the job's progress.
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inPhoneApp } from "@/api/client.ts";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Checkbox } from "@/ui/components/checkbox.tsx";
import { Disclosure } from "@/ui/disclosure.tsx";
import { Panel } from "@/ui/panel.tsx";
import { usePracticeCourse, useStartPracticeCourse, useStopPracticeCourse } from "./api.ts";
import { ErrorLine } from "./parts.tsx";
import { useLlm } from "./setup-api.ts";

const STEPS = ["reading", "listening", "writing", "speaking"] as const;
type Step = (typeof STEPS)[number];

export function CoursePractice({
  series,
  course,
  edition,
}: {
  series: string;
  course: string;
  edition: string;
}) {
  const { t } = useTranslation();
  const llm = useLlm();
  const what = { series, course, edition };
  const state = usePracticeCourse(what);
  const start = useStartPracticeCourse();
  const stop = useStopPracticeCourse();
  const [steps, setSteps] = useState<Step[]>([...STEPS]);
  const [count, setCount] = useState("1");
  if (!state.data?.lessons) return null;
  const { lessons, made, variants, voice, job } = state.data;
  const running = job?.state === "running" || job?.state === "stopping";
  const chosen = steps.filter((s) => voice || s !== "listening");
  const why = !llm.data?.model ? t("practice.needsModel") : undefined;
  const toggle = (step: Step, on: boolean) =>
    setSteps((now) => (on ? [...now, step] : now.filter((s) => s !== step)));
  return (
    <Panel>
      <Disclosure
        title={
          <>
            <Sparkles className="size-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">{t("practice.course.title")}</h2>
            <span className="text-sm font-normal">
              {running && job
                ? t("practice.course.progress", { done: job.done, total: job.total })
                : t("practice.course.made", { made, lessons })}
            </span>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("practice.course.intro")}</p>
          <p>
            <span className="text-muted-foreground">
              {STEPS.map((step) =>
                t("practice.course.variant", {
                  step: t(`lesson.step.${step}`),
                  count: variants[step],
                }),
              ).join(" · ")}
            </span>
          </p>
          {/* Made on the computer, never on the phone: there, only how much the course has. */}
          {inPhoneApp ? null : running && job ? (
            <div className="space-y-2" aria-live="polite">
              <progress className="w-full" value={job.done} max={job.total} />
              <p className="text-sm">
                {t("practice.course.progress", { done: job.done, total: job.total })}
                {job.current.map(
                  (u) =>
                    ` · ${t("practice.course.current", {
                      lesson: u.lessonKey.split("/").at(-1),
                      step: t(`lesson.step.${u.step}`),
                    })}`,
                )}
                {job.failed.length > 0 &&
                  ` · ${t("practice.course.failed", { count: job.failed.length })}`}
              </p>
              <Button
                variant="outline"
                disabled={job.state === "stopping"}
                loading={stop.isPending}
                onClick={() => stop.mutate(what)}
              >
                {t("practice.course.stop")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {job?.state === "done" || job?.state === "stopped" ? (
                <p className="text-sm text-muted-foreground">
                  {t(job.state === "done" ? "practice.course.done" : "practice.course.stopped", {
                    made: job.done - job.failed.length,
                    total: job.total,
                  })}
                  {job.failed.length > 0 &&
                    ` · ${t("practice.course.failed", { count: job.failed.length })}`}
                </p>
              ) : null}
              <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
                <legend className="sr-only">{t("practice.course.steps")}</legend>
                {STEPS.map((step) => {
                  const off = step === "listening" && !voice;
                  return (
                    // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is inside
                    <label key={step} className="flex items-center gap-2 pointer-coarse:min-h-11">
                      <Checkbox
                        checked={!off && steps.includes(step)}
                        disabled={off}
                        onCheckedChange={(on) => toggle(step, on === true)}
                      />
                      <span className={off ? "text-muted-foreground" : undefined}>
                        {t(`lesson.step.${step}`)}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <p className="text-sm text-muted-foreground">{t("practice.course.upTo")}</p>
              {!voice && (
                <p className="text-sm text-muted-foreground">{t("error.practice_needs_voice")}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Choice
                  label={t("practice.count")}
                  value={count}
                  onChange={setCount}
                  options={["1", "2", "3"].map((n) => [
                    n,
                    t("practice.times", { count: Number(n) }),
                  ])}
                />
                <Button
                  disabled={!!why || !chosen.length}
                  loading={start.isPending}
                  onClick={() => start.mutate({ ...what, steps: chosen, count: Number(count) })}
                >
                  {t("practice.course.make")}
                </Button>
              </div>
              {why && <p className="text-sm text-muted-foreground">{why}</p>}
              <ErrorLine error={start.error} />
            </div>
          )}
        </div>
      </Disclosure>
    </Panel>
  );
}
