// An answer said aloud without a phrase to say, checked by the model from what was heard: asked as it
// is shown — by itself only where nothing else can check the answer (owner, 2026-10-15), else on the
// learner's "Why?" (owner, 2026-10-18) —, once for the same words; kept in the lesson run and shown
// again without asking. Nothing is shown while no assistant is set up.
import { type ExerciseKey, itemKey, type TypedEvent } from "@sprachanker/schema";
import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SpokenCheckView } from "@/ui/checked-text.tsx";
import { type SpeakingRequest, useCheckSpoken, useSpokenChecks } from "./api.ts";
import { modelName } from "./assistant-label.tsx";
import { AnswerBox, ErrorLine, Thinking } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

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
    (c) => c.itemKey === key && c.input === props.transcript,
  );
  const request = { ...props, language: i18n.language };
  const ask = () => check.mutate(request, { onSuccess: ({ event }) => event && onStored(event) });
  const askRef = useRef(ask);
  askRef.current = ask;

  // Asked by itself once for each words heard (a new take is a new answer); a failure waits for
  // Try again.
  const askedFor = useRef<string | null>(null);
  const due = ready && !kept.isPending && !saved;
  useEffect(() => {
    if (!due || askedFor.current === props.transcript) return;
    askedFor.current = props.transcript;
    askRef.current();
  }, [due, props.transcript]);

  if (!saved && (!ready || kept.isPending)) return null;
  // Not failed: waiting for the check (or for it to be shown kept).
  if (!saved && !check.isError)
    return (
      <div className="mt-2 flex items-center gap-1 text-sm" aria-live="polite">
        <Sparkles className="size-4 text-muted-foreground" />
        <Thinking label={t("speech.aiChecking")} />
        <PromptButton request={{ speaking: request }} />
      </div>
    );
  return (
    <AnswerBox className="mt-2">
      {saved ? (
        <SpokenCheckView
          transcript={saved.input}
          check={saved.result}
          header={
            <>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Sparkles className="size-4" /> {modelName(saved.model)}
              </span>
              <span className="ms-auto">
                <PromptButton request={{ speaking: request }} />
              </span>
            </>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4" />
          <ErrorLine error={check.error} provider={llm.data?.provider ?? undefined} onRetry={ask} />
          <span className="ms-auto">
            <PromptButton request={{ speaking: request }} />
          </span>
        </div>
      )}
    </AnswerBox>
  );
}
