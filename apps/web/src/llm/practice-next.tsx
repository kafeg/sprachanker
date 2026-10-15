// "Another version" in a lesson's practice step (owner, 2026-10-15): the step's next variant of the
// course's practice the learner has not had, no model; none left, no button — the latest stays. A step
// with nothing yet (the lesson's start took none for it) takes its first as it opens: the server takes
// it only while the step still has no work, so a take at the lesson's start or a second page makes no
// second one.
import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client.ts";
import type { LessonSlotContext } from "@/lesson/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { useNextVariant, usePracticeLesson } from "./api.ts";
import { ErrorLine } from "./parts.tsx";

type Step = "reading" | "listening" | "writing" | "speaking";

/** None left after all (another page took the last): nothing to say, the button goes. */
const noneLeft = (error: unknown) => error instanceof ApiError && error.message === "no_such_item";

export function NextVariant({
  ids,
  step,
  empty = false,
  disabled = false,
}: {
  ids: LessonSlotContext;
  step: Step;
  /** The step has no work yet: its first is taken at once, "loading" said meanwhile. */
  empty?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const pack = usePracticeLesson(ids);
  const next = useNextVariant(ids, step);
  const left = pack.data?.[step].left ?? 0;
  const asked = useRef(false);
  const take = next.mutate;
  useEffect(() => {
    if (!empty || !left || asked.current) return;
    asked.current = true;
    take(true);
  }, [empty, left, take]);
  const error = noneLeft(next.error) ? null : (next.error ?? pack.error);
  if (empty)
    return error ? (
      <ErrorLine error={error} onRetry={() => (pack.error ? void pack.refetch() : take(true))} />
    ) : left > 0 || pack.isPending || next.isPending ? (
      <p className="text-muted-foreground">{t("common.loading")}</p>
    ) : null;
  if (!left) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="outline"
        loading={next.isPending}
        disabled={disabled || next.isPending}
        onClick={() => take(false)}
      >
        {!next.isPending && <RefreshCw className="size-4" />}
        {t("practice.another")}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}
