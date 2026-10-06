// "Why is this wrong?" under a wrong answer: asks the configured model and streams its explanation.
import { Link } from "@tanstack/react-router";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { type ExplainRequest, streamExplain, useLlm } from "./api.ts";
import { useAssistantLabel } from "./assistant-label.tsx";
import { ErrorLine, useAbortable } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { RichText } from "./rich-text.tsx";

/** "Why is this wrong?" for one item. `autoStart`: asked when shown (the exercise has its own button). */
export function ExplainMistake({
  autoStart = false,
  ...props
}: Omit<ExplainRequest, "language"> & { autoStart?: boolean }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const label = useAssistantLabel();
  const [text, setText] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const request = useAbortable();
  const asked = useRef(false);
  const ready = !!llm.data?.model;

  const ask = () => {
    const controller = request.start();
    setBusy(true);
    setError(undefined);
    setText("");
    streamExplain({ ...props, language: i18n.language }, setText, controller.signal)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (request.isCurrent(controller)) setBusy(false);
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once, when shown and ready
  useEffect(() => {
    if (!autoStart || !ready || asked.current) return;
    asked.current = true;
    ask();
  }, [autoStart, ready]);

  if (!llm.data) return null;
  if (!ready)
    return (
      <Link to="/settings" className="mt-2 inline-block text-sm text-muted-foreground underline">
        {t("llm.setUpHint")}
      </Link>
    );

  const promptRequest = { explain: { ...props, language: i18n.language } };
  return (
    <div className="mt-2">
      {text === undefined ? (
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          <Button variant="ghost" className="text-base" onClick={ask}>
            <Sparkles className="size-4" /> {t("llm.why")}
          </Button>
          <PromptButton request={promptRequest} />
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/50 px-4 py-3" aria-live="polite">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Sparkles className="size-4" /> {t("llm.explanation")}
            {label && <span className="font-normal">· {label}</span>}
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            <span className="ml-auto">
              <PromptButton request={promptRequest} />
            </span>
          </div>
          {text ? (
            <RichText text={text} />
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
