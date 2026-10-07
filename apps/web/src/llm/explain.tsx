// "Why is this wrong?" under a wrong answer: asks the configured model and streams its explanation. In a
// lesson run the explanation is kept with the attempt it explains (05): shown again without asking, and
// "Explain again" asks anew.
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { type ExplainRequest, streamExplain, useExplanations, useLlm } from "./api.ts";
import { useAssistantLabel } from "./assistant-label.tsx";
import { ErrorLine, useAbortable } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { RichText } from "./rich-text.tsx";

/** "Why is this wrong?" for one item. `autoStart`: asked when shown, unless one is kept already. */
export function ExplainMistake({
  autoStart = false,
  ...props
}: Omit<ExplainRequest, "language"> & { autoStart?: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const llm = useLlm();
  const label = useAssistantLabel();
  const kept = useExplanations(props.lessonKey, props.runId);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const request = useAbortable();
  const asked = useRef(false);
  const ready = !!llm.data?.model;
  // Item keys are "<exercise>#<n>", 1-based (02).
  const itemKey = `${props.exerciseKey}#${props.index + 1}`;
  const saved = kept.data?.explanations.findLast(
    (e) => e.itemKey === itemKey && e.attempt === props.attempt,
  );
  const loaded = !props.runId || !kept.isPending;

  const ask = () => {
    const controller = request.start();
    setBusy(true);
    setError(undefined);
    setText("");
    streamExplain({ ...props, language: i18n.language }, setText, controller.signal)
      .then(() => client.invalidateQueries({ queryKey: ["explanations", props.runId] }))
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
      <Link to="/settings" className="mt-2 inline-block text-sm text-muted-foreground underline">
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
