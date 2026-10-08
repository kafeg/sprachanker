// An answer said aloud without a phrase to say, checked by the model from what was heard (08): asked as
// soon as the answer is heard, once for the same words; kept in the lesson run and shown again without
// asking. Nothing is shown while no assistant is set up.
import { type ExerciseKey, itemKey, type TypedEvent } from "@sprachanker/schema";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SpokenCheckView } from "@/ui/checked-text.tsx";
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
  const asked = useRef<string>(undefined);
  const ready = !!llm.data?.model;
  const key = itemKey(props.exerciseKey, props.index + 1);
  const saved = kept.data?.checks.findLast(
    (c) => c.itemKey === key && c.transcript === props.transcript,
  );
  const request = { ...props, language: i18n.language };
  const ask = () => check.mutate(request, { onSuccess: ({ event }) => event && onStored(event) });

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once for the words heard, when ready
  useEffect(() => {
    if (!ready || kept.isPending || saved || asked.current === props.transcript) return;
    asked.current = props.transcript;
    ask();
  }, [ready, kept.isPending, props.transcript]);

  if (!saved && !ready) return null;
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
