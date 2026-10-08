// An answer said aloud without a phrase to say, checked by the model from what was heard (08): asked
// with "Check with AI" under it (owner, 2026-10-09), once for the same words; kept in the lesson run
// and shown again without asking. Nothing is shown while no assistant is set up.
import { type ExerciseKey, itemKey, type TypedEvent } from "@sprachanker/schema";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SpokenCheckView } from "@/ui/checked-text.tsx";
import { Button } from "@/ui/components/button.tsx";
import { type SpeakingRequest, useCheckSpoken, useLlm, useSpokenChecks } from "./api.ts";
import { modelName } from "./assistant-label.tsx";
import { ErrorLine } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

export function SpokenAnswerCheck({
  onStored,
  ...props
}: Omit<SpeakingRequest, "language" | "exerciseKey"> & {
  exerciseKey: ExerciseKey;
  onStored(event: TypedEvent): void;
}) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const kept = useSpokenChecks(props.lessonKey, props.runId);
  const check = useCheckSpoken();
  const ready = !!llm.data?.model;
  const key = itemKey(props.exerciseKey, props.index + 1);
  const saved = kept.data?.checks.findLast(
    (c) => c.itemKey === key && c.transcript === props.transcript,
  );
  const request = { ...props, language: i18n.language };
  const ask = () => check.mutate(request, { onSuccess: ({ event }) => event && onStored(event) });

  // The check asked for these words (a new take is a new answer to ask about).
  const asked = check.variables?.transcript === props.transcript && !check.isIdle;

  if (!saved && (!ready || kept.isPending)) return null;
  if (!saved && !asked)
    return (
      <div className="mt-2 flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={ask}>
          <Sparkles className="size-4" /> {t("speech.aiCheck")}
        </Button>
        <PromptButton request={{ speaking: request }} />
      </div>
    );
  return (
    <div className="mt-2 rounded-xl border bg-muted/50 px-4 py-3" aria-live="polite">
      {saved ? (
        <SpokenCheckView
          transcript={saved.transcript}
          check={saved.result}
          header={
            <>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Sparkles className="size-4" /> {modelName(saved.model)}
              </span>
              <span className="ml-auto">
                <PromptButton request={{ speaking: request }} />
              </span>
            </>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4" />
          {check.isError ? (
            <ErrorLine error={check.error} provider={llm.data?.provider ?? undefined}>
              {" "}
              <button type="button" className="underline" onClick={ask}>
                {t("common.retry")}
              </button>
            </ErrorLine>
          ) : (
            <>
              {t("speech.aiChecking")} <LoaderCircle className="size-4 animate-spin" />
            </>
          )}
          <span className="ml-auto">
            <PromptButton request={{ speaking: request }} />
          </span>
        </div>
      )}
    </div>
  );
}
