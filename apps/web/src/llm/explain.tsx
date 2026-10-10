// "Why is this wrong?" under a wrong answer: asks the configured model and streams its explanation. In a
// lesson run the explanation is kept with the attempt it explains (05): shown again without asking, and
// "Explain again" asks anew.
import { type ExerciseKey, itemKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import {
  type ExplainRequest,
  streamExplain,
  useExplanations,
  useExplanationsKept,
  useLlm,
} from "./api.ts";
import { useAssistantLabel } from "./assistant-label.tsx";
import { ErrorLine, useAbortable } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

/** "Why is this wrong?" for one item. `autoStart`: asked when shown, unless one is kept already;
 *  `stored`: resolves once the run's answers are stored (the attempt explained is looked up there). */
export function ExplainMistake({
  autoStart = false,
  stored,
  ...props
}: Omit<ExplainRequest, "language" | "exerciseKey"> & {
  exerciseKey: ExerciseKey;
  autoStart?: boolean;
  stored?: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const refreshKept = useExplanationsKept(props.runId);
  const llm = useLlm();
  const label = useAssistantLabel();
  const kept = useExplanations(props.lessonKey, props.runId);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const request = useAbortable();
  const asked = useRef(false);
  const ready = !!llm.data?.model;
  const key = itemKey(props.exerciseKey, props.index + 1);
  const saved = kept.data?.explanations.findLast(
    (e) => e.itemKey === key && e.attempt === props.attempt,
  );
  const loaded = !props.runId || !kept.isPending;

  const ask = () => {
    const controller = request.start();
    setBusy(true);
    setError(undefined);
    setText("");
    // The answer explained may still be on its way: the server explains it as stored.
    (stored?.() ?? Promise.resolve())
      .then(() => streamExplain({ ...props, language: i18n.language }, setText, controller.signal))
      .then(refreshKept)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (request.isCurrent(controller)) setBusy(false);
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once, when shown and ready
  useEffect(() => {
    if (!autoStart || !ready || !loaded || saved || asked.current) return;
    asked.current = true;
    ask();
  }, [autoStart, ready, loaded]);

  if (!llm.data) return null;
  const shown = text ?? saved?.text;
  if (!ready && shown === undefined)
    return (
      <Link
        to="/settings"
        hash="ai"
        className="mt-2 inline-block text-sm text-muted-foreground underline"
      >
        {t("llm.setUpHint")}
      </Link>
    );

  const promptRequest = { explain: { ...props, language: i18n.language } };
  return (
    <div className="mt-2">
      {shown === undefined ? (
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          <Button variant="ghost" className="text-base" onClick={ask} disabled={!loaded}>
            <Sparkles className="size-4" /> {t("lesson.why")}
          </Button>
          <PromptButton request={promptRequest} />
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/50 px-4 py-3" aria-live="polite">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Sparkles className="size-4" /> {t("llm.explanation")}
            {/* A kept explanation names the model that wrote it. */}
            {text === undefined && saved ? (
              <span className="font-normal">· {saved.model}</span>
            ) : (
              label && <span className="font-normal">· {label}</span>
            )}
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            <span className="ml-auto flex items-center gap-1">
              {!busy && ready && (
                <Button variant="ghost" size="sm" className="h-8" onClick={ask}>
                  <RotateCcw className="size-3.5" /> {t("llm.explainAgain")}
                </Button>
              )}
              <PromptButton request={promptRequest} />
            </span>
          </div>
          {shown ? (
            <RichText text={shown} />
          ) : (
            busy && <p className="text-muted-foreground">{t("llm.thinking")}</p>
          )}
          <ErrorLine error={error} provider={llm.data.provider ?? undefined}>
            {" "}
            <button type="button" className="underline" onClick={ask}>
              {t("common.retry")}
            </button>
          </ErrorLine>
        </div>
      )}
    </div>
  );
}
