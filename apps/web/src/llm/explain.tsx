// "Why is this wrong?" under a wrong answer: asks the configured model and streams its explanation.
import { Link } from "@tanstack/react-router";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { type ExplainRequest, streamExplain, useLlm } from "./api.ts";
import { useAssistantLabel } from "./assistant-label.tsx";
import { errorText } from "./errors.ts";
import { PromptButton } from "./prompt-view.tsx";
import { RichText } from "./rich-text.tsx";

export function ExplainMistake(props: Omit<ExplainRequest, "language">) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const label = useAssistantLabel();
  const [text, setText] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController>(undefined);
  useEffect(() => () => abort.current?.abort(), []);

  if (!llm.data) return null;
  if (!llm.data.model)
    return (
      <Link to="/settings" className="mt-2 inline-block text-sm text-muted-foreground underline">
        {t("llm.setUpHint")}
      </Link>
    );

  const ask = () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(undefined);
    setText("");
    streamExplain({ ...props, language: i18n.language }, setText, controller.signal)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (abort.current === controller) setBusy(false);
      });
  };

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
          {!!error && (
            <p className="mt-1 text-sm text-wrong">
              {errorText(t, error, llm.data.provider ?? undefined)}{" "}
              <button type="button" className="underline" onClick={ask}>
                {t("common.retry")}
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
